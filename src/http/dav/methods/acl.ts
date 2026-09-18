// ---------------------------------------------------------------------------
// ACL handler — RFC 3744 §8.1
//
// Supported path kinds:
//   collection      → collection ACL
//   instance        → instance ACL
//   principal       → principal ACL
//   userCollection  → virtual resource ACL (USERS_VIRTUAL_RESOURCE_ID)
//   groupCollection → virtual resource ACL (GROUPS_VIRTUAL_RESOURCE_ID)
//   new-collection / new-instance → 404 (resource does not exist)
//   root / principalCollection / wellknown → 405
//
// Server restrictions declared via DAV:acl-restrictions:
//   DAV:grant-only  — deny ACEs are forbidden
//   DAV:no-invert   — inverted ACEs are forbidden
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import { cn } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import {
	badRequest,
	forbidden,
	methodNotAllowed,
	notFound,
	unauthorized,
} from "#src/domain/errors.ts";
import { isUuid, PrincipalId, type UuidString } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import type { ResolvedDavPath, Slug } from "#src/domain/types/path.ts";
import {
	GROUPS_VIRTUAL_RESOURCE_ID,
	USERS_VIRTUAL_RESOURCE_ID,
} from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	isXmlNode,
	xmlChild,
	xmlPath,
} from "#src/http/dav/methods/xml-node.ts";
import { normalizeClarkNames } from "#src/http/dav/xml/clark.ts";
import { parseXml, readXmlBody } from "#src/http/dav/xml/parser.ts";
import { HTTP_OK } from "#src/http/status.ts";
import type { NewAce, ResourceType } from "#src/services/acl/index.ts";
import type { AclResourceId } from "#src/services/acl/service.ts";
import { AclService } from "#src/services/acl/service.ts";
import { PrincipalRepository } from "#src/services/principal/repository.ts";

const TRAILING_SLASH = /\/$/u;

// ---------------------------------------------------------------------------
// Namespace constants
// ---------------------------------------------------------------------------

const DAV_NS = "DAV:";
const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";

// Clark keys for structural ACL elements
const ACL_KEY = cn(DAV_NS, "acl");
const ACE_KEY = cn(DAV_NS, "ace");
const PRINCIPAL_KEY = cn(DAV_NS, "principal");
const GRANT_KEY = cn(DAV_NS, "grant");
const DENY_KEY = cn(DAV_NS, "deny");
const PRIVILEGE_KEY = cn(DAV_NS, "privilege");
const HREF_KEY = cn(DAV_NS, "href");
const ALL_KEY = cn(DAV_NS, "all");
const AUTH_KEY = cn(DAV_NS, "authenticated");
const UNAUTH_KEY = cn(DAV_NS, "unauthenticated");
const SELF_KEY = cn(DAV_NS, "self");
const INVERT_KEY = cn(DAV_NS, "invert");
const PROPERTY_KEY = cn(DAV_NS, "property");

// ---------------------------------------------------------------------------
// Privilege map — Clark key → DavPrivilege string
// Used to validate privilege names in ACE bodies.
// ---------------------------------------------------------------------------

const PRIVILEGE_MAP = new Map<string, DavPrivilege>([
	[cn(DAV_NS, "read"), "DAV:read"],
	[cn(DAV_NS, "write"), "DAV:write"],
	[cn(DAV_NS, "write-properties"), "DAV:write-properties"],
	[cn(DAV_NS, "write-content"), "DAV:write-content"],
	[cn(DAV_NS, "unlock"), "DAV:unlock"],
	[cn(DAV_NS, "read-acl"), "DAV:read-acl"],
	[
		cn(DAV_NS, "read-current-user-privilege-set"),
		"DAV:read-current-user-privilege-set",
	],
	[cn(DAV_NS, "write-acl"), "DAV:write-acl"],
	[cn(DAV_NS, "bind"), "DAV:bind"],
	[cn(DAV_NS, "unbind"), "DAV:unbind"],
	[cn(DAV_NS, "all"), "DAV:all"],
	[cn(CALDAV_NS, "schedule-deliver"), "CALDAV:schedule-deliver"],
	[cn(CALDAV_NS, "schedule-deliver-invite"), "CALDAV:schedule-deliver-invite"],
	[cn(CALDAV_NS, "schedule-deliver-reply"), "CALDAV:schedule-deliver-reply"],
	[cn(CALDAV_NS, "schedule-query-freebusy"), "CALDAV:schedule-query-freebusy"],
	[cn(CALDAV_NS, "schedule-send"), "CALDAV:schedule-send"],
	[cn(CALDAV_NS, "schedule-send-invite"), "CALDAV:schedule-send-invite"],
	[cn(CALDAV_NS, "schedule-send-reply"), "CALDAV:schedule-send-reply"],
	[cn(CALDAV_NS, "schedule-send-freebusy"), "CALDAV:schedule-send-freebusy"],
	[cn(CALDAV_NS, "read-free-busy"), "CALDAV:read-free-busy"],
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize a value to a ReadonlyArray, handling single-element XML nodes. */
const toArray = (v: unknown): ReadonlyArray<unknown> =>
	v === undefined || v === null ? [] : Array.isArray(v) ? v : [v];

// ---------------------------------------------------------------------------
// Intermediate types
// ---------------------------------------------------------------------------

interface ParsedAce {
	readonly principalType:
		| "principal"
		| "all"
		| "authenticated"
		| "unauthenticated"
		| "self";
	/** Only set when principalType === "principal". */
	readonly principalHref?: string;
	readonly privileges: ReadonlyArray<DavPrivilege>;
}

// ---------------------------------------------------------------------------
// parseAclBody — extract ParsedAce list from the XML request body
// ---------------------------------------------------------------------------

// Non-href principal forms, in the order RFC 3744 §5.5.1 lists them
const PRINCIPAL_TYPE_KEYS: ReadonlyArray<
	readonly [string, ParsedAce["principalType"]]
> = [
	[ALL_KEY, "all"],
	[AUTH_KEY, "authenticated"],
	[UNAUTH_KEY, "unauthenticated"],
	[SELF_KEY, "self"],
];

/** The principal half of an ACE */
type AcePrincipal = Pick<ParsedAce, "principalType" | "principalHref">;

/** Reads a DAV:principal element, rejecting the forms the server restricts */
const parsePrincipal = (
	principal: Record<string, unknown>,
): Effect.Effect<AcePrincipal, DavError> => {
	if (INVERT_KEY in principal) {
		return Effect.fail(forbidden("DAV:no-invert"));
	}
	if (PROPERTY_KEY in principal) {
		return Effect.fail(forbidden("DAV:not-supported-privilege"));
	}
	if (HREF_KEY in principal) {
		return Effect.succeed({
			principalType: "principal" as const,
			principalHref: String(principal[HREF_KEY]),
		});
	}
	const found = PRINCIPAL_TYPE_KEYS.find(([key]) => key in principal);
	return found === undefined
		? Effect.fail(forbidden("DAV:missing-required-principal"))
		: Effect.succeed({ principalType: found[1] });
};

/** Reads the privileges of a DAV:grant, rejecting any name the server does not define */
const parsePrivileges = (
	grant: Record<string, unknown>,
): Effect.Effect<ReadonlyArray<DavPrivilege>, DavError> =>
	Effect.gen(function* () {
		const privileges: Array<DavPrivilege> = [];
		for (const rawPriv of toArray(grant[PRIVILEGE_KEY])) {
			if (!isXmlNode(rawPriv)) {
				continue;
			}
			for (const key of Object.keys(rawPriv)) {
				if (key.startsWith("@_")) {
					continue;
				}
				const privilege = PRIVILEGE_MAP.get(key);
				if (privilege === undefined) {
					return yield* Effect.fail(forbidden("DAV:not-supported-privilege"));
				}
				privileges.push(privilege);
			}
		}
		return privileges;
	});

/** Reads one DAV:ace; an entry with no principal or no grant is skipped */
const parseAce = (
	rawAce: unknown,
): Effect.Effect<Option.Option<ParsedAce>, DavError> =>
	Effect.gen(function* () {
		if (!isXmlNode(rawAce)) {
			return Option.none();
		}
		const principalEl = xmlChild(rawAce, PRINCIPAL_KEY);
		if (principalEl === undefined) {
			return Option.none();
		}
		const { principalType, principalHref } = yield* parsePrincipal(principalEl);

		// Deny ACEs are forbidden (server declares grant-only)
		if (DENY_KEY in rawAce) {
			return yield* Effect.fail(forbidden("DAV:grant-only"));
		}

		const grant = xmlChild(rawAce, GRANT_KEY);
		if (grant === undefined) {
			return Option.none();
		}
		const privileges = yield* parsePrivileges(grant);
		return Option.some({ principalType, principalHref, privileges });
	});

const parseAclBody = (
	req: Request,
): Effect.Effect<ReadonlyArray<ParsedAce>, DavError> =>
	Effect.gen(function* () {
		const body = yield* readXmlBody(req);
		if (body.trim() === "") {
			return [];
		}

		const raw = yield* parseXml(body).pipe(
			Effect.catchTag("XmlParseError", () =>
				Effect.fail(badRequest("Invalid ACL XML")),
			),
		);

		const aclEl = xmlPath(normalizeClarkNames(raw), ACL_KEY);
		if (aclEl === undefined) {
			return [];
		}

		const parsedAces: Array<ParsedAce> = [];
		for (const rawAce of toArray(aclEl[ACE_KEY])) {
			Option.map(yield* parseAce(rawAce), (ace) => parsedAces.push(ace));
		}
		return parsedAces;
	});

// ---------------------------------------------------------------------------
// resolveHrefPrincipal — look up a principal from its URL href
// ---------------------------------------------------------------------------

const resolveHrefPrincipal = (
	href: string,
): Effect.Effect<PrincipalId, DavError | DatabaseError, PrincipalRepository> =>
	Effect.gen(function* () {
		// Extract path from absolute or relative URL
		let path = href;
		if (href.startsWith("http://") || href.startsWith("https://")) {
			path = new URL(href).pathname;
		}

		// Last non-empty path segment is the principal slug or UUID
		const seg = path
			.replace(TRAILING_SLASH, "")
			.split("/")
			.filter(Boolean)
			.at(-1);

		if (seg === undefined) {
			return yield* Effect.fail(forbidden("DAV:recognized-principal"));
		}

		const repo = yield* PrincipalRepository;
		const result = yield* isUuid(seg)
			? repo
					.findById(PrincipalId(seg as UuidString))
					.pipe(Effect.map(Option.map((row) => row.principal)))
			: repo.findPrincipalBySlug(seg as Slug);

		return yield* Option.match(result, {
			onNone: () => Effect.fail(forbidden("DAV:recognized-principal")),
			onSome: (principal) => Effect.succeed(principal.id as PrincipalId),
		});
	});

// ---------------------------------------------------------------------------
// ACL target resolution and ACE building
// ---------------------------------------------------------------------------

/** The resource an ACE row is stored against */
interface AclTarget {
	readonly resourceId: AclResourceId;
	readonly resourceType: ResourceType;
}

/** Path kinds that carry an ACL; every other kind is rejected before this point */
type AclTargetPath = Extract<
	ResolvedDavPath,
	{
		kind:
			| "principal"
			| "collection"
			| "instance"
			| "userCollection"
			| "groupCollection";
	}
>;

/** Maps an ACL-bearing path to the resource its ACEs are stored against */
const aclTarget = (path: AclTargetPath): AclTarget => {
	if (path.kind === "principal") {
		return { resourceId: path.principalId, resourceType: "principal" };
	}
	if (path.kind === "collection") {
		return { resourceId: path.collectionId, resourceType: "collection" };
	}
	if (path.kind === "userCollection") {
		return {
			resourceId: USERS_VIRTUAL_RESOURCE_ID as AclResourceId,
			resourceType: "virtual",
		};
	}
	if (path.kind === "groupCollection") {
		return {
			resourceId: GROUPS_VIRTUAL_RESOURCE_ID as AclResourceId,
			resourceType: "virtual",
		};
	}
	return { resourceId: path.instanceId, resourceType: "instance" };
};

/**
 * Turns parsed ACEs into the rows to store, resolving each href principal to its
 * id. Ordinals are spaced by ten so the source ACE an ACE row came from stays
 * recoverable.
 */
const buildNewAces = (
	parsedAces: ReadonlyArray<ParsedAce>,
	target: AclTarget,
): Effect.Effect<
	ReadonlyArray<NewAce>,
	DavError | DatabaseError,
	PrincipalRepository
> =>
	Effect.gen(function* () {
		const AceOrdinalStride = 10;
		const newAces: Array<NewAce> = [];
		for (const [aceIndex, parsedAce] of parsedAces.entries()) {
			const resolvedPrincipalId =
				parsedAce.principalType === "principal"
					? yield* resolveHrefPrincipal(parsedAce.principalHref ?? "")
					: undefined;

			for (const privilege of parsedAce.privileges) {
				newAces.push({
					resourceType: target.resourceType,
					resourceId: target.resourceId,
					principalType: parsedAce.principalType,
					principalId: resolvedPrincipalId,
					privilege,
					grantDeny: "grant",
					protected: false,
					ordinal: aceIndex * AceOrdinalStride,
				});
			}
		}
		return newAces;
	});

// ---------------------------------------------------------------------------
// aclHandler
// ---------------------------------------------------------------------------

export const aclHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
	req: Request,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	AclService | PrincipalRepository
> =>
	Effect.gen(function* () {
		// Auth gate first — defense in depth alongside the central davRouter gate.
		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const actingPrincipalId = ctx.auth.principal.principalId;

		// Reject unsupported path kinds
		if (
			path.kind === "wellknown" ||
			path.kind === "root" ||
			path.kind === "principalCollection" ||
			path.kind === "collectionHome" ||
			path.kind === "groupMembers"
		) {
			return yield* Effect.fail(methodNotAllowed());
		}
		if (
			path.kind === "new-collection" ||
			path.kind === "new-instance" ||
			path.kind === "newUser" ||
			path.kind === "newGroup" ||
			path.kind === "groupMemberNonExistent" ||
			path.kind === "user" ||
			path.kind === "group" ||
			path.kind === "groupMember" ||
			path.kind === "unknownPrincipal"
		) {
			return yield* Effect.fail(notFound());
		}

		// Determine the target resource identity
		const { resourceId, resourceType } = aclTarget(path);

		// Must have DAV:write-acl on the resource
		const acl = yield* AclService;
		yield* acl.check(
			actingPrincipalId,
			resourceId,
			resourceType,
			"DAV:write-acl",
		);

		yield* Effect.logTrace("acl.method", { resourceId, resourceType });

		// Parse the ACL body
		const parsedAces = yield* parseAclBody(req);

		// Resolve href principals and build NewAce rows
		const newAces = yield* buildNewAces(parsedAces, {
			resourceId,
			resourceType,
		});

		// Atomically replace all non-protected ACEs
		yield* acl.setAces(resourceId, resourceType, newAces);

		return new Response(null, { status: HTTP_OK });
	});
