import { Effect, Option } from "effect";
import { type DavError, notFound } from "#src/domain/errors.ts";
import {
	CollectionId,
	GroupId,
	InstanceId,
	isUuid,
	PrincipalId,
	UserId,
	type UuidString,
} from "#src/domain/ids.ts";
import {
	type CollectionNamespace,
	NAMESPACE_TO_COLLECTION_TYPE,
	parseCollectionNamespace,
} from "#src/domain/types/collection-namespace.ts";
import { type ResolvedDavPath, Slug } from "#src/domain/types/path.ts";
import { CollectionRepository } from "#src/services/collection/index.ts";
import { GroupRepository } from "#src/services/group/index.ts";
import { InstanceRepository } from "#src/services/instance/index.ts";
import { PrincipalRepository } from "#src/services/principal/index.ts";
import { UserRepository } from "#src/services/user/index.ts";

const TRAILING_SLASH = /\/$/u;

// ---------------------------------------------------------------------------
// DAV path resolution — slug/UUID segments to branded ids
//
// URL patterns handled:
//   /.well-known/caldav                          → wellknown
//   /.well-known/carddav                         → wellknown
//   /dav/                                        → root
//   /dav/principals/                             → principalCollection
//   /dav/principals/:slug                        → principal
//   /dav/principals/:slug/:ns/:collSlug          → collection
//   /dav/principals/:slug/:ns/:collSlug/:obj     → instance
//
// :ns is a CollectionNamespace segment ("cal", "card", "inbox", "outbox", "col")
// that scopes slugs per collection type, allowing the same slug to exist
// across different types under one principal.
//
// Lives apart from router.ts so the COPY/MOVE handlers can resolve their
// Destination header without importing the router that dispatches to them.
// ---------------------------------------------------------------------------

// Segment counts after stripping /dav (index 0 = "principals")
const SEGMENTS_PRINCIPAL = 2; // ["principals", ":slug"]
const SEGMENTS_NAMESPACE = 3; // ["principals", ":slug", ":ns"]
const SEGMENTS_COLLECTION = 4; // ["principals", ":slug", ":ns", ":collSlug"]

// Segment counts for /dav/groups/ tree (index 0 = "groups")
const SEGMENTS_GROUP = 2; // ["groups", ":slug"]
const SEGMENTS_GROUP_MEMBERS = 3; // ["groups", ":slug", "members"]

/**
 * Resolve a segment that may address a row by UUID or by slug.
 *
 * A slug may itself be UUID-shaped — e.g. python-caldav's make_calendar() names
 * a new calendar after a random uuid4() — so a UUID-shaped segment that matches
 * no row by id, or matches one `owns` rejects, still falls back to the slug
 * lookup. `bySlug` is always scoped to the parent, so the fallback can never
 * resolve to another parent's row.
 */
const resolveByIdOrSlug = <A, E, R>(
	segment: string,
	byId: (id: UuidString) => Effect.Effect<Option.Option<A>, E, R>,
	bySlug: Effect.Effect<Option.Option<A>, E, R>,
	owns: (row: A) => boolean = () => true,
): Effect.Effect<Option.Option<A>, E, R> =>
	isUuid(segment)
		? Effect.flatMap(
				byId(segment),
				Option.match({
					onNone: () => bySlug,
					onSome: (row) =>
						owns(row) ? Effect.succeed(Option.some(row)) : bySlug,
				}),
			)
		: bySlug;

// ---------------------------------------------------------------------------
// /dav/groups/ tree
// ---------------------------------------------------------------------------

/** Resolve /dav/groups/:slug[/members[/:member]] */
const parseGroupPath = Effect.fn("dav.parsePath.group")(function* (
	segments: ReadonlyArray<string>,
	groupSeg: string,
	path: string,
) {
	yield* Effect.logTrace("dav.parsePath: resolving group segment", {
		segment: groupSeg,
	});
	const groupRepo = yield* GroupRepository;
	const groupOpt = yield* isUuid(groupSeg)
		? groupRepo.findById(GroupId(groupSeg))
		: groupRepo.findBySlug(Slug(groupSeg));
	if (Option.isNone(groupOpt)) {
		yield* Effect.logTrace("dav.parsePath: group not found, treating as new", {
			segment: groupSeg,
		});
		return {
			kind: "newGroup",
			slug: Slug(groupSeg),
		} satisfies ResolvedDavPath;
	}
	const groupRow = groupOpt.value;
	const principalId = PrincipalId(groupRow.principal.id);
	const groupId = GroupId(groupRow.group.id);

	if (segments.length === SEGMENTS_GROUP) {
		yield* Effect.logTrace("dav.parsePath: group resolved", { groupId });
		return {
			kind: "group",
			principalId,
			groupId,
			groupSeg,
		} satisfies ResolvedDavPath;
	}

	// /dav/groups/:slug/members/
	const seg2 = decodeURIComponent(segments[2] ?? "");
	if (seg2 !== "members") {
		return yield* Effect.fail(notFound(`Unknown DAV path: ${path}`));
	}

	if (segments.length === SEGMENTS_GROUP_MEMBERS) {
		return {
			kind: "groupMembers",
			principalId,
			groupId,
			groupSeg,
		} satisfies ResolvedDavPath;
	}

	return yield* parseGroupMember(decodeURIComponent(segments[3] ?? ""), {
		principalId,
		groupId,
		groupSeg,
	});
});

/** The resolved group a member segment hangs off */
interface GroupContext {
	readonly principalId: ReturnType<typeof PrincipalId>;
	readonly groupId: ReturnType<typeof GroupId>;
	readonly groupSeg: string;
}

/** Resolve the member segment of /dav/groups/:slug/members/:member */
const parseGroupMember = Effect.fn("dav.parsePath.groupMember")(function* (
	memberSeg: string,
	group: GroupContext,
) {
	const userRepo = yield* UserRepository;
	const memberOpt = yield* isUuid(memberSeg)
		? userRepo.findById(UserId(memberSeg))
		: userRepo.findBySlug(Slug(memberSeg));
	if (Option.isNone(memberOpt)) {
		return {
			kind: "groupMemberNonExistent",
			principalId: group.principalId,
			groupId: group.groupId,
			groupSeg: group.groupSeg,
			slug: Slug(memberSeg),
		} satisfies ResolvedDavPath;
	}
	return {
		kind: "groupMember",
		principalId: group.principalId,
		groupId: group.groupId,
		memberUserId: UserId(memberOpt.value.user.id),
		groupSeg: group.groupSeg,
		memberSeg,
	} satisfies ResolvedDavPath;
});

/** Parse and resolve a DAV URL path, converting slugs/UUIDs to branded UUIDs.
 *
 * Each path segment is detected as either a UUID or a slug:
 * - UUID segments are resolved via `findById` and ownership is verified against
 *   the parent (collection must belong to the resolved principal; instance must
 *   belong to the resolved collection).
 * - Slug segments are resolved via `findBySlug` as before.
 * - Missing resources still yield `new-collection` / `new-instance` regardless
 *   of whether the segment looked like a UUID, so PUT/MKCOL to a UUID-style URL
 *   is handled correctly.
 */
export const parseDavPath = (
	url: URL,
): Effect.Effect<
	ResolvedDavPath,
	DavError | import("#src/domain/errors.ts").DatabaseError,
	// Narrow R to exactly the repos parseDavPath actually queries. Avoids
	// dragging DavServices' transitive requirements (e.g. mutation-only
	// services) into callers that just want path resolution.
	| PrincipalRepository
	| UserRepository
	| GroupRepository
	| CollectionRepository
	| InstanceRepository
> => {
	const path = url.pathname.replace(TRAILING_SLASH, ""); // strip trailing slash

	if (path === "/.well-known/caldav") {
		return Effect.succeed({ kind: "wellknown", name: "caldav" });
	}
	if (path === "/.well-known/carddav") {
		return Effect.succeed({ kind: "wellknown", name: "carddav" });
	}

	// Strip /dav base prefix before parsing segments
	const davPrefix = "/dav";
	const davRelative = path.startsWith(davPrefix)
		? path.slice(davPrefix.length)
		: path;
	const segments = davRelative.split("/").filter(Boolean);

	// /dav/ or /dav — root DAV collection
	if (segments.length === 0) {
		return Effect.succeed({ kind: "root" } satisfies ResolvedDavPath);
	}

	// /dav/users/ tree
	if (segments[0] === "users") {
		if (segments.length === 1) {
			return Effect.succeed({
				kind: "userCollection",
			} satisfies ResolvedDavPath);
		}
		const userSeg = decodeURIComponent(segments[1] ?? "");
		return Effect.gen(function* () {
			yield* Effect.logTrace("dav.parsePath: resolving user segment", {
				segment: userSeg,
			});
			const userRepo = yield* UserRepository;
			const userOpt = yield* isUuid(userSeg)
				? userRepo.findById(UserId(userSeg))
				: userRepo.findBySlug(Slug(userSeg));
			if (Option.isNone(userOpt)) {
				yield* Effect.logTrace(
					"dav.parsePath: user not found, treating as new",
					{
						segment: userSeg,
					},
				);
				return {
					kind: "newUser",
					slug: Slug(userSeg),
				} satisfies ResolvedDavPath;
			}
			const row = userOpt.value;
			yield* Effect.logTrace("dav.parsePath: user resolved", {
				userId: row.user.id,
			});
			return {
				kind: "user",
				principalId: PrincipalId(row.principal.id),
				userId: UserId(row.user.id),
				userSeg,
			} satisfies ResolvedDavPath;
		});
	}

	// /dav/groups/ tree
	if (segments[0] === "groups") {
		if (segments.length === 1) {
			return Effect.succeed({
				kind: "groupCollection",
			} satisfies ResolvedDavPath);
		}
		return parseGroupPath(
			segments,
			decodeURIComponent(segments[1] ?? ""),
			path,
		);
	}

	if (segments[0] !== "principals") {
		return Effect.fail(notFound(`Unknown DAV path: ${path}`));
	}

	// /dav/principals/ — principal-collection listing
	if (segments.length === 1) {
		return Effect.succeed({
			kind: "principalCollection",
		} satisfies ResolvedDavPath);
	}

	return parsePrincipalPath(segments, decodeURIComponent(segments[1] ?? ""));
};

// ---------------------------------------------------------------------------
// /dav/principals/ tree
// ---------------------------------------------------------------------------

/** Resolve /dav/principals/:slug[/:ns[/:coll[/:instance]]] */
const parsePrincipalPath = Effect.fn("dav.parsePath.principal")(function* (
	segments: ReadonlyArray<string>,
	seg1: string,
) {
	yield* Effect.logTrace("dav.parsePath: resolving principal segment", {
		segment: seg1,
	});
	const principalRepo = yield* PrincipalRepository;
	const principalOpt = yield* resolveByIdOrSlug(
		seg1,
		(id) => principalRepo.findPrincipalById(PrincipalId(id)),
		principalRepo.findPrincipalBySlug(Slug(seg1)),
	);
	if (Option.isNone(principalOpt)) {
		yield* Effect.logDebug("dav.parsePath: unknown principal", {
			segment: seg1,
		});
		return {
			kind: "unknownPrincipal",
			principalSeg: seg1,
		} satisfies ResolvedDavPath;
	}
	const principalId = PrincipalId(principalOpt.value.id);

	if (segments.length === SEGMENTS_PRINCIPAL) {
		yield* Effect.logTrace("dav.parsePath: principal resolved", {
			principalId,
		});
		return {
			kind: "principal",
			principalId,
			principalSeg: seg1,
		} satisfies ResolvedDavPath;
	}

	// seg2 must be a known collection namespace — reject anything else
	const seg2 = decodeURIComponent(segments[2] ?? "");
	const namespaceOpt = parseCollectionNamespace(seg2);
	if (Option.isNone(namespaceOpt)) {
		return yield* notFound(`Unknown collection namespace: ${seg2}`);
	}
	const namespace = namespaceOpt.value;

	// /dav/principals/:slug/:ns — the per-type home collection (calendar home,
	// addressbook home, …). RFC 4918 §5.2: this ancestor of the typed
	// collections beneath it MUST be an addressable collection.
	if (segments.length === SEGMENTS_NAMESPACE) {
		yield* Effect.logTrace("dav.parsePath: collection home resolved", {
			principalId,
			namespace,
		});
		return {
			kind: "collectionHome",
			principalId,
			namespace,
			principalSeg: seg1,
		} satisfies ResolvedDavPath;
	}

	return yield* parseCollectionPath(segments, {
		principalId,
		principalSeg: seg1,
		namespace,
	});
});

/** The resolved principal and namespace a collection segment hangs off */
interface PrincipalContext {
	readonly principalId: ReturnType<typeof PrincipalId>;
	readonly principalSeg: string;
	readonly namespace: CollectionNamespace;
}

/** Resolve the collection segment, and the instance segment beneath it */
const parseCollectionPath = Effect.fn("dav.parsePath.collection")(function* (
	segments: ReadonlyArray<string>,
	parent: PrincipalContext,
) {
	const { principalId, principalSeg, namespace } = parent;
	const seg3 = decodeURIComponent(segments[3] ?? "");
	yield* Effect.logTrace("dav.parsePath: resolving collection segment", {
		principalId,
		namespace,
		segment: seg3,
	});
	const collRepo = yield* CollectionRepository;
	const collectionType = NAMESPACE_TO_COLLECTION_TYPE[namespace];
	const collRowOpt = yield* resolveByIdOrSlug(
		seg3,
		(id) => collRepo.findById(CollectionId(id)),
		collRepo.findBySlug(principalId, collectionType, Slug(seg3)),
		(row) => row.ownerPrincipalId === principalId,
	);
	if (Option.isNone(collRowOpt)) {
		yield* Effect.logTrace(
			"dav.parsePath: collection not found, treating as new",
			{ segment: seg3 },
		);
		return {
			kind: "new-collection",
			principalId,
			namespace,
			slug: Slug(seg3),
			principalSeg,
		} satisfies ResolvedDavPath;
	}
	const collectionId = CollectionId(collRowOpt.value.id);

	if (segments.length === SEGMENTS_COLLECTION) {
		yield* Effect.logTrace("dav.parsePath: collection resolved", {
			collectionId,
		});
		return {
			kind: "collection",
			principalId,
			namespace,
			collectionId,
			principalSeg,
			collectionSeg: seg3,
		} satisfies ResolvedDavPath;
	}

	return yield* parseInstancePath(decodeURIComponent(segments[4] ?? ""), {
		principalId,
		principalSeg,
		namespace,
		collectionId,
		collectionSeg: seg3,
	});
});

/** The resolved collection an instance segment hangs off */
interface CollectionContext extends PrincipalContext {
	readonly collectionId: ReturnType<typeof CollectionId>;
	readonly collectionSeg: string;
}

/** Resolve the final instance segment of a collection path */
const parseInstancePath = Effect.fn("dav.parsePath.instance")(function* (
	seg4: string,
	parent: CollectionContext,
) {
	const { principalId, principalSeg, namespace, collectionId, collectionSeg } =
		parent;
	yield* Effect.logTrace("dav.parsePath: resolving instance segment", {
		collectionId,
		segment: seg4,
	});
	const instRepo = yield* InstanceRepository;
	const instRowOpt = yield* resolveByIdOrSlug(
		seg4,
		(id) => instRepo.findById(InstanceId(id)),
		instRepo.findBySlug(collectionId, Slug(seg4)),
		(row) => row.collectionId === collectionId,
	);
	if (Option.isNone(instRowOpt)) {
		yield* Effect.logTrace(
			"dav.parsePath: instance not found, treating as new",
			{ segment: seg4 },
		);
		return {
			kind: "new-instance",
			principalId,
			namespace,
			collectionId,
			slug: Slug(seg4),
			principalSeg,
			collectionSeg,
		} satisfies ResolvedDavPath;
	}

	yield* Effect.logTrace("dav.parsePath: instance resolved", {
		instanceId: instRowOpt.value.id,
	});
	return {
		kind: "instance",
		principalId,
		namespace,
		collectionId,
		instanceId: InstanceId(instRowOpt.value.id),
		principalSeg,
		collectionSeg,
		instanceSeg: seg4,
	} satisfies ResolvedDavPath;
});
