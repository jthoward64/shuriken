import { Effect, Option } from "effect";
import {
	type AppError,
	conflict,
	type DavError,
	type DavPrecondition,
	notFound,
} from "#src/domain/errors.ts";
import {
	CollectionId,
	GroupId,
	InstanceId,
	isUuid,
	PrincipalId,
	UserId,
} from "#src/domain/ids.ts";
import {
	NAMESPACE_TO_COLLECTION_TYPE,
	parseCollectionNamespace,
} from "#src/domain/types/collection-namespace.ts";
import { type ResolvedDavPath, Slug } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	HTTP_METHOD_NOT_ALLOWED,
	HTTP_UNAUTHORIZED,
} from "#src/http/status.ts";
import type { AclService } from "#src/services/acl/index.ts";
import type { CalIndexRepository } from "#src/services/cal-index/index.ts";
import type { CardIndexRepository } from "#src/services/card-index/index.ts";
import type { CollectionService } from "#src/services/collection/index.ts";
import { CollectionRepository } from "#src/services/collection/index.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { EntityRepository } from "#src/services/entity/index.ts";
import type { GroupService } from "#src/services/group/index.ts";
import { GroupRepository } from "#src/services/group/index.ts";
import type { InstanceService } from "#src/services/instance/index.ts";
import { InstanceRepository } from "#src/services/instance/index.ts";
import { PrincipalRepository } from "#src/services/principal/index.ts";
import type { PrincipalService } from "#src/services/principal/service.ts";
import type { SchedulingService } from "#src/services/scheduling/index.ts";
import type {
	CalTimezoneRepository,
	IanaTimezoneService,
} from "#src/services/timezone/index.ts";
import type { TombstoneRepository } from "#src/services/tombstone/index.ts";
import type { UserService } from "#src/services/user/index.ts";
import { UserRepository } from "#src/services/user/index.ts";
import { aclHandler } from "./methods/acl.ts";
import { copyHandler } from "./methods/copy.ts";
import { deleteHandler } from "./methods/delete.ts";
import { getHandler } from "./methods/get.ts";
import { groupDeleteHandler } from "./methods/groups/delete.ts";
import { groupMemberDeleteHandler } from "./methods/groups/member-delete.ts";
import { groupMemberPutHandler } from "./methods/groups/member-put.ts";
import { groupMkcolHandler } from "./methods/groups/mkcol.ts";
import { groupPropfindHandler } from "./methods/groups/propfind.ts";
import { groupProppatchHandler } from "./methods/groups/proppatch.ts";
import { mkcolHandler } from "./methods/mkcol.ts";
import { moveHandler } from "./methods/move.ts";
import { optionsHandler } from "./methods/options.ts";
import { propfindHandler } from "./methods/propfind.ts";
import { postHandler } from "./methods/post.ts";
import { proppatchHandler } from "./methods/proppatch.ts";
import { putHandler } from "./methods/put.ts";
import { reportHandler } from "./methods/report.ts";
import { userDeleteHandler } from "./methods/users/delete.ts";
import { userMkcolHandler } from "./methods/users/mkcol.ts";
import { userPropfindHandler } from "./methods/users/propfind.ts";
import { userProppatchHandler } from "./methods/users/proppatch.ts";

// ---------------------------------------------------------------------------
// DAV error XML body builder — RFC 4918 §8.7 / RFC 4791 §5.3.2
// ---------------------------------------------------------------------------

const PRECONDITION_NS: Readonly<Record<string, string>> = {
	DAV: "DAV:",
	CALDAV: "urn:ietf:params:xml:ns:caldav",
	CARDDAV: "urn:ietf:params:xml:ns:carddav",
};

/**
 * Build a minimal <D:error> XML body for a DavError precondition.
 * Preconditions follow "PREFIX:local-name" convention defined in errors.ts.
 */
const buildDavErrorBody = (precondition: DavPrecondition): string => {
	const colon = precondition.indexOf(":");
	const prefix = precondition.slice(0, colon);
	const local = precondition.slice(colon + 1);
	const ns = PRECONDITION_NS[prefix] ?? "DAV:";
	if (prefix === "DAV") {
		return `<?xml version="1.0" encoding="UTF-8"?><D:error xmlns:D="DAV:"><D:${local}/></D:error>`;
	}
	return `<?xml version="1.0" encoding="UTF-8"?><D:error xmlns:D="DAV:" xmlns:E="${ns}"><E:${local}/></D:error>`;
};

// ---------------------------------------------------------------------------
// DAV router — slug resolution + method dispatch
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
// ---------------------------------------------------------------------------

type DavServices =
	| PrincipalRepository
	| CollectionRepository
	| InstanceRepository
	| CollectionService
	| InstanceService
	| AclService
	| PrincipalService
	| EntityRepository
	| ComponentRepository
	| CalTimezoneRepository
	| IanaTimezoneService
	| TombstoneRepository
	| CalIndexRepository
	| CardIndexRepository
	| UserRepository
	| GroupRepository
	| UserService
	| GroupService
	| SchedulingService;

// Segment counts after stripping /dav (index 0 = "principals")
const SEGMENTS_PRINCIPAL = 2; // ["principals", ":slug"]
const SEGMENTS_NAMESPACE = 3; // ["principals", ":slug", ":ns"]
const SEGMENTS_COLLECTION = 4; // ["principals", ":slug", ":ns", ":collSlug"]

// Segment counts for /dav/groups/ tree (index 0 = "groups")
const SEGMENTS_GROUP = 2; // ["groups", ":slug"]
const SEGMENTS_GROUP_MEMBERS = 3; // ["groups", ":slug", "members"]

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
	DavServices
> => {
	const path = url.pathname.replace(/\/$/, ""); // strip trailing slash

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
			const userRepo = yield* UserRepository;
			const userOpt = yield* isUuid(userSeg)
				? userRepo.findById(UserId(userSeg))
				: userRepo.findBySlug(Slug(userSeg));
			if (Option.isNone(userOpt)) {
				return {
					kind: "newUser",
					slug: Slug(userSeg),
				} satisfies ResolvedDavPath;
			}
			const row = userOpt.value;
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
		const groupSeg = decodeURIComponent(segments[1] ?? "");
		return Effect.gen(function* () {
			const groupRepo = yield* GroupRepository;
			const groupOpt = yield* isUuid(groupSeg)
				? groupRepo.findById(GroupId(groupSeg))
				: groupRepo.findBySlug(Slug(groupSeg));
			if (Option.isNone(groupOpt)) {
				return {
					kind: "newGroup",
					slug: Slug(groupSeg),
				} satisfies ResolvedDavPath;
			}
			const groupRow = groupOpt.value;
			const principalId = PrincipalId(groupRow.principal.id);
			const groupId = GroupId(groupRow.group.id);

			// /dav/groups/:slug/members/
			if (segments.length === SEGMENTS_GROUP) {
				return {
					kind: "group",
					principalId,
					groupId,
					groupSeg,
				} satisfies ResolvedDavPath;
			}

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

			const memberSeg = decodeURIComponent(segments[3] ?? "");
			const userRepo = yield* UserRepository;
			const memberOpt = yield* isUuid(memberSeg)
				? userRepo.findById(UserId(memberSeg))
				: userRepo.findBySlug(Slug(memberSeg));
			if (Option.isNone(memberOpt)) {
				return {
					kind: "groupMemberNonExistent",
					principalId,
					groupId,
					groupSeg,
					slug: Slug(memberSeg),
				} satisfies ResolvedDavPath;
			}
			return {
				kind: "groupMember",
				principalId,
				groupId,
				memberUserId: UserId(memberOpt.value.user.id),
				groupSeg,
				memberSeg,
			} satisfies ResolvedDavPath;
		});
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

	const seg1 = decodeURIComponent(segments[1] ?? "");

	return Effect.gen(function* () {
		const principalRepo = yield* PrincipalRepository;
		const principalOpt = yield* isUuid(seg1)
			? principalRepo.findById(PrincipalId(seg1))
			: principalRepo.findBySlug(Slug(seg1));
		if (Option.isNone(principalOpt)) {
			return {
				kind: "unknownPrincipal",
				principalSeg: seg1,
			} satisfies ResolvedDavPath;
		}
		const principalRow = principalOpt.value;
		const principalId = PrincipalId(principalRow.principal.id);

		if (segments.length === SEGMENTS_PRINCIPAL) {
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
		const collectionType = NAMESPACE_TO_COLLECTION_TYPE[namespace];

		// Paths that stop at the namespace level (/dav/principals/:slug/:ns) are not valid
		if (segments.length === SEGMENTS_NAMESPACE) {
			return yield* notFound(`Invalid DAV path: ${path}`);
		}

		const seg3 = decodeURIComponent(segments[3] ?? "");
		const collRepo = yield* CollectionRepository;
		const collRowOpt = yield* isUuid(seg3)
			? collRepo.findById(CollectionId(seg3)).pipe(
					Effect.flatMap(
						Option.match({
							onNone: () => Effect.succeed(Option.none()),
							onSome: (row) =>
								row.ownerPrincipalId === principalId
									? Effect.succeed(Option.some(row))
									: Effect.fail(notFound(`Collection not found: ${seg3}`)),
						}),
					),
				)
			: collRepo.findBySlug(principalId, collectionType, Slug(seg3));
		if (Option.isNone(collRowOpt)) {
			return {
				kind: "new-collection",
				principalId,
				namespace,
				slug: Slug(seg3),
				principalSeg: seg1,
			} satisfies ResolvedDavPath;
		}
		const collectionId = CollectionId(collRowOpt.value.id);

		if (segments.length === SEGMENTS_COLLECTION) {
			return {
				kind: "collection",
				principalId,
				namespace,
				collectionId,
				principalSeg: seg1,
				collectionSeg: seg3,
			} satisfies ResolvedDavPath;
		}

		const seg4 = decodeURIComponent(segments[4] ?? "");
		const instRepo = yield* InstanceRepository;
		const instRowOpt = yield* isUuid(seg4)
			? instRepo.findById(InstanceId(seg4)).pipe(
					Effect.flatMap(
						Option.match({
							onNone: () => Effect.succeed(Option.none()),
							onSome: (row) =>
								row.collectionId === collectionId
									? Effect.succeed(Option.some(row))
									: Effect.fail(notFound(`Instance not found: ${seg4}`)),
						}),
					),
				)
			: instRepo.findBySlug(collectionId, Slug(seg4));
		if (Option.isNone(instRowOpt)) {
			return {
				kind: "new-instance",
				principalId,
				namespace,
				collectionId,
				slug: Slug(seg4),
				principalSeg: seg1,
				collectionSeg: seg3,
			} satisfies ResolvedDavPath;
		}

		return {
			kind: "instance",
			principalId,
			namespace,
			collectionId,
			instanceId: InstanceId(instRowOpt.value.id),
			principalSeg: seg1,
			collectionSeg: seg3,
			instanceSeg: seg4,
		} satisfies ResolvedDavPath;
	});
};

/** Dispatch a DAV request to the appropriate method handler. */
export const davRouter = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<Response, AppError, DavServices> =>
	Effect.gen(function* () {
		const path = yield* parseDavPath(ctx.url);
		yield* Effect.logTrace("dav path resolved", { kind: path.kind });

		// RFC 6764 §5: /.well-known/caldav and /.well-known/carddav must redirect
		// to the DAV context path so clients can perform service discovery.
		if (path.kind === "wellknown") {
			yield* Effect.logTrace("dav well-known redirect", { name: path.name });
			return new Response(null, {
				status: 301,
				headers: { Location: "/dav/" },
			});
		}

		// /dav/ and /dav/principals/ are valid paths — fall through to method dispatch
		// (handlers return 501 until implemented in Step 4)

		const method = req.method.toUpperCase();
		yield* Effect.logTrace("dav method dispatch", { method, kind: path.kind });

		// Principal does not exist — MKCOL/MKCALENDAR/PUT → 409 (missing intermediate
		// collection, RFC 4918 §9.3.1 / §9.7); everything else → 404.
		if (path.kind === "unknownPrincipal") {
			if (method === "MKCOL" || method === "MKCALENDAR" || method === "PUT") {
				return yield* conflict();
			}
			return yield* Effect.fail(notFound());
		}

		// Dispatch user/group admin paths first before the principal/collection handlers
		if (
			path.kind === "userCollection" ||
			path.kind === "user" ||
			path.kind === "newUser"
		) {
			switch (method) {
				case "PROPFIND":
					return yield* userPropfindHandler(path, ctx);
				case "PROPPATCH":
					return yield* userProppatchHandler(path, ctx, req);
				case "MKCOL":
					return yield* userMkcolHandler(path, ctx, req);
				case "DELETE":
					return yield* userDeleteHandler(path, ctx);
				default:
					break;
			}
		}

		if (
			path.kind === "groupCollection" ||
			path.kind === "group" ||
			path.kind === "newGroup" ||
			path.kind === "groupMembers" ||
			path.kind === "groupMember" ||
			path.kind === "groupMemberNonExistent"
		) {
			switch (method) {
				case "PROPFIND":
					return yield* groupPropfindHandler(path, ctx);
				case "PROPPATCH":
					return yield* groupProppatchHandler(path, ctx, req);
				case "MKCOL":
					return yield* groupMkcolHandler(path, ctx, req);
				case "DELETE":
					if (path.kind === "groupMember") {
						return yield* groupMemberDeleteHandler(path, ctx);
					}
					return yield* groupDeleteHandler(path, ctx);
				case "PUT":
					return yield* groupMemberPutHandler(path, ctx);
				default:
					break;
			}
		}

		switch (method) {
			case "OPTIONS":
				return yield* optionsHandler(path, ctx);
			case "PROPFIND":
				return yield* propfindHandler(path, ctx, req);
			case "PROPPATCH":
				return yield* proppatchHandler(path, ctx, req);
			case "REPORT":
				return yield* reportHandler(path, ctx, req);
			case "GET":
			case "HEAD":
				return yield* getHandler(path, ctx);
			case "PUT":
				return yield* putHandler(path, ctx, req);
			case "DELETE":
				return yield* deleteHandler(path, ctx);
			case "COPY":
				return yield* copyHandler(path, ctx, req);
			case "MOVE":
				return yield* moveHandler(path, ctx, req);
			case "MKCOL":
			case "MKCALENDAR":
			case "MKADDRESSBOOK":
				return yield* mkcolHandler(path, ctx, req);
			case "POST":
				return yield* postHandler(path, ctx, req);
			case "ACL":
				return yield* aclHandler(path, ctx, req);
			default:
				yield* Effect.logInfo("dav method not allowed", { method });
				return new Response(null, {
					status: HTTP_METHOD_NOT_ALLOWED,
					headers: {
						Allow:
							"OPTIONS, GET, HEAD, PUT, DELETE, COPY, MOVE, PROPFIND, PROPPATCH, MKCOL, REPORT, MKCALENDAR, MKADDRESSBOOK, ACL",
					},
				});
		}
	}).pipe(
		Effect.catchTag("DavError", (err) => {
			const body = err.precondition
				? buildDavErrorBody(err.precondition)
				: null;
			const headers: Record<string, string> = body
				? { "Content-Type": "application/xml; charset=utf-8" }
				: {};
			if (err.status === HTTP_UNAUTHORIZED) {
				headers["WWW-Authenticate"] = 'Basic realm="shuriken"';
			}
			return Effect.succeed(
				new Response(body, { status: err.status, headers }),
			);
		}),
		Effect.withSpan("dav.route", {
			attributes: { "dav.path": ctx.url.pathname },
		}),
	);
