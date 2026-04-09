// ---------------------------------------------------------------------------
// ACL handler — RFC 3744 §8.1
//
// Supported path kinds:
//   collection  → collection ACL
//   instance    → instance ACL
//   principal   → principal ACL
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
import { forbidden, methodNotAllowed, notFound } from "#src/domain/errors.ts";
import { isUuid, PrincipalId, type UuidString } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import type { ResolvedDavPath, Slug } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { normalizeClarkNames } from "#src/http/dav/xml/clark.ts";
import { parseXml, readXmlBody } from "#src/http/dav/xml/parser.ts";
import { HTTP_OK } from "#src/http/status.ts";
import type { AclResourceType, NewAce } from "#src/services/acl/index.ts";
import type { AclResourceId } from "#src/services/acl/service.ts";
import { AclService } from "#src/services/acl/service.ts";
import { PrincipalRepository } from "#src/services/principal/repository.ts";

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
				Effect.fail(forbidden(undefined, "Invalid ACL XML")),
			),
		);

		const tree = normalizeClarkNames(raw) as Record<string, unknown>;
		const aclEl = tree[ACL_KEY];
		if (typeof aclEl !== "object" || aclEl === null) {
			return [];
		}

		const aceEls = toArray((aclEl as Record<string, unknown>)[ACE_KEY]);
		const parsedAces: Array<ParsedAce> = [];

		for (const rawAce of aceEls) {
			if (typeof rawAce !== "object" || rawAce === null) {
				continue;
			}
			const ace = rawAce as Record<string, unknown>;

			// Extract principal element
			const principalEl = ace[PRINCIPAL_KEY];
			if (typeof principalEl !== "object" || principalEl === null) {
				continue;
			}
			const principal = principalEl as Record<string, unknown>;

			// Detect principal type
			let principalType: ParsedAce["principalType"];
			let principalHref: string | undefined;

			if (INVERT_KEY in principal) {
				return yield* Effect.fail(forbidden("DAV:no-invert"));
			}
			if (PROPERTY_KEY in principal) {
				return yield* Effect.fail(forbidden("DAV:not-supported-privilege"));
			}
			if (HREF_KEY in principal) {
				principalType = "principal";
				principalHref = String(principal[HREF_KEY]);
			} else if (ALL_KEY in principal) {
				principalType = "all";
			} else if (AUTH_KEY in principal) {
				principalType = "authenticated";
			} else if (UNAUTH_KEY in principal) {
				principalType = "unauthenticated";
			} else if (SELF_KEY in principal) {
				principalType = "self";
			} else {
				return yield* Effect.fail(forbidden("DAV:missing-required-principal"));
			}

			// Deny ACEs are forbidden (server declares grant-only)
			if (DENY_KEY in ace) {
				return yield* Effect.fail(forbidden("DAV:grant-only"));
			}

			// Extract grant element and privileges
			const grantEl = ace[GRANT_KEY];
			if (typeof grantEl !== "object" || grantEl === null) {
				continue;
			}
			const grant = grantEl as Record<string, unknown>;

			const privilegeEls = toArray(grant[PRIVILEGE_KEY]);
			const privileges: Array<DavPrivilege> = [];

			for (const rawPriv of privilegeEls) {
				if (typeof rawPriv !== "object" || rawPriv === null) {
					continue;
				}
				const privEl = rawPriv as Record<string, unknown>;

				for (const key of Object.keys(privEl)) {
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

			parsedAces.push({ principalType, principalHref, privileges });
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
		const seg = path.replace(/\/$/, "").split("/").filter(Boolean).at(-1);

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
		// Reject unsupported path kinds
		if (
			path.kind === "wellknown" ||
			path.kind === "root" ||
			path.kind === "principalCollection" ||
			path.kind === "userCollection" ||
			path.kind === "groupCollection" ||
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
		let resourceId: AclResourceId;
		let resourceType: AclResourceType;
		if (path.kind === "principal") {
			resourceId = path.principalId;
			resourceType = "principal";
		} else if (path.kind === "collection") {
			resourceId = path.collectionId;
			resourceType = "collection";
		} else {
			// instance
			resourceId = path.instanceId;
			resourceType = "instance";
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* forbidden("DAV:need-privileges");
		}
		const actingPrincipalId = ctx.auth.principal.principalId;

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
		const newAces: Array<NewAce> = [];
		for (const [aceIndex, parsedAce] of parsedAces.entries()) {
			let resolvedPrincipalId: PrincipalId | undefined;
			if (parsedAce.principalType === "principal") {
				resolvedPrincipalId = yield* resolveHrefPrincipal(
					parsedAce.principalHref ?? "",
				);
			}

			for (const privilege of parsedAce.privileges) {
				newAces.push({
					resourceType,
					resourceId,
					principalType: parsedAce.principalType,
					principalId: resolvedPrincipalId,
					privilege,
					grantDeny: "grant",
					protected: false,
					ordinal: aceIndex * 10,
				});
			}
		}

		// Atomically replace all non-protected ACEs
		yield* acl.setAces(resourceId, resourceType, newAces);

		return new Response(null, { status: HTTP_OK });
	});
