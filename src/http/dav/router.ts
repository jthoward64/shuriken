import { Effect, Metric } from "effect";
import type { AppConfigService } from "#src/config.ts";
import type { DatabaseClient } from "#src/db/client.ts";
import {
	type AppError,
	conflict,
	type DavError,
	type DavPrecondition,
	notFound,
	unauthorized,
} from "#src/domain/errors.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	HTTP_METHOD_NOT_ALLOWED,
	HTTP_UNAUTHORIZED,
} from "#src/http/status.ts";
import { davRequestsTotal } from "#src/observability/metrics.ts";
import type { AclService } from "#src/services/acl/index.ts";
import type { BirthdayService } from "#src/services/birthday/service.ts";
import type { CalIndexRepository } from "#src/services/cal-index/index.ts";
import type { CardIndexRepository } from "#src/services/card-index/index.ts";
import type {
	CollectionRepository,
	CollectionService,
} from "#src/services/collection/index.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { EntityRepository } from "#src/services/entity/index.ts";
import type { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import type {
	GroupRepository,
	GroupService,
} from "#src/services/group/index.ts";
import type {
	InstanceRepository,
	InstanceService,
} from "#src/services/instance/index.ts";
import type { PrincipalRepository } from "#src/services/principal/index.ts";
import type { PrincipalService } from "#src/services/principal/service.ts";
import type { SchedulingService } from "#src/services/scheduling/index.ts";
import type {
	CalTimezoneRepository,
	IanaTimezoneService,
} from "#src/services/timezone/index.ts";
import type { TombstoneRepository } from "#src/services/tombstone/index.ts";
import type { UserRepository, UserService } from "#src/services/user/index.ts";
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
import { postHandler } from "./methods/post.ts";
import { propfindHandler } from "./methods/propfind.ts";
import { proppatchHandler } from "./methods/proppatch.ts";
import { putHandler } from "./methods/put.ts";
import { reportHandler } from "./methods/report.ts";
import { userDeleteHandler } from "./methods/users/delete.ts";
import { userMkcolHandler } from "./methods/users/mkcol.ts";
import { userPropfindHandler } from "./methods/users/propfind.ts";
import { userProppatchHandler } from "./methods/users/proppatch.ts";
import { parseDavPath } from "./parse-path.ts";

const TRAILING_SLASH = /\/$/u;

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
	| BirthdayService
	| DatabaseClient
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
	| ExternalCalendarRepository
	| SchedulingService
	| AppConfigService;

/** Dispatch a DAV request to the appropriate method handler. */
/**
 * Path kinds that resolve to a collection-shaped resource. Used by the
 * Content-Location post-processor (RFC 4918 §5.2) to add a canonical
 * with-slash hint when the client addressed a collection without a slash.
 */
const COLLECTION_KINDS: ReadonlySet<string> = new Set([
	"root",
	"principalCollection",
	"principal",
	"collectionHome",
	"collection",
	"userCollection",
	"user",
	"groupCollection",
	"group",
	"groupMembers",
]);

// ---------------------------------------------------------------------------
// Method dispatch tables
// ---------------------------------------------------------------------------

/** A dispatch table from HTTP method name to the handler that serves it */
interface MethodHandlers {
	readonly [method: string]: (
		path: ResolvedDavPath,
		ctx: HttpRequestContext,
		req: Request,
	) => Effect.Effect<Response, AppError, DavServices>;
}

/** Path kinds served by the admin user handlers */
const USER_ADMIN_KINDS: ReadonlySet<string> = new Set([
	"userCollection",
	"user",
	"newUser",
]);

/** Path kinds served by the admin group handlers */
const GROUP_ADMIN_KINDS: ReadonlySet<string> = new Set([
	"groupCollection",
	"group",
	"newGroup",
	"groupMembers",
	"groupMember",
	"groupMemberNonExistent",
]);

/** Methods handled on an admin user path; any other falls through to the generic dispatch */
const USER_METHOD_HANDLERS: MethodHandlers = {
	PROPFIND: (path, ctx) => userPropfindHandler(path, ctx),
	PROPPATCH: userProppatchHandler,
	MKCOL: userMkcolHandler,
	DELETE: (path, ctx) => userDeleteHandler(path, ctx),
};

/** Methods handled on an admin group path; any other falls through */
const GROUP_METHOD_HANDLERS: MethodHandlers = {
	PROPFIND: (path, ctx) => groupPropfindHandler(path, ctx),
	PROPPATCH: groupProppatchHandler,
	MKCOL: groupMkcolHandler,
	DELETE: (path, ctx) =>
		path.kind === "groupMember"
			? groupMemberDeleteHandler(path, ctx)
			: groupDeleteHandler(path, ctx),
	PUT: (path, ctx) => groupMemberPutHandler(path, ctx),
};

/**
 * Methods allowed on a per-type home collection (/dav/principals/:slug/:ns). It
 * is a virtual container — enumerable, but not itself created, deleted or
 * written — so everything else is 405.
 */
const COLLECTION_HOME_METHOD_HANDLERS: MethodHandlers = {
	OPTIONS: (path, ctx) => optionsHandler(path, ctx),
	PROPFIND: propfindHandler,
};

/** Generic per-resource dispatch */
const DAV_METHOD_HANDLERS: MethodHandlers = {
	OPTIONS: (path, ctx) => optionsHandler(path, ctx),
	PROPFIND: propfindHandler,
	PROPPATCH: proppatchHandler,
	REPORT: reportHandler,
	GET: (path, ctx) => getHandler(path, ctx),
	HEAD: (path, ctx) => getHandler(path, ctx),
	PUT: putHandler,
	DELETE: (path, ctx) => deleteHandler(path, ctx),
	COPY: copyHandler,
	MOVE: moveHandler,
	MKCOL: mkcolHandler,
	MKCALENDAR: mkcolHandler,
	MKADDRESSBOOK: mkcolHandler,
	POST: postHandler,
	ACL: aclHandler,
};

const SUPPORTED_METHODS =
	"OPTIONS, GET, HEAD, PUT, DELETE, COPY, MOVE, PROPFIND, PROPPATCH, MKCOL, REPORT, MKCALENDAR, MKADDRESSBOOK, ACL";

/** RFC 4918 §9: a 405 carrying the Allow header for the addressed resource */
const methodNotAllowedResponse = (allow: string): Response =>
	new Response(null, {
		status: HTTP_METHOD_NOT_ALLOWED,
		headers: { Allow: allow },
	});

/** Methods on an unknown principal that mean a missing intermediate collection */
const CREATE_METHODS: ReadonlySet<string> = new Set([
	"MKCOL",
	"MKCALENDAR",
	"PUT",
]);

/**
 * Principal does not exist — MKCOL/MKCALENDAR/PUT → 409 (missing intermediate
 * collection, RFC 4918 §9.3.1 / §9.7); everything else → 404.
 */
const unknownPrincipalError = (method: string): DavError =>
	CREATE_METHODS.has(method) ? conflict() : notFound();

/** RFC 6764 §5 service-discovery endpoints, served without authentication */
const WELL_KNOWN_PATHS: ReadonlySet<string> = new Set([
	"/.well-known/caldav",
	"/.well-known/carddav",
]);

/**
 * Central auth gate: every DAV request must be authenticated, except
 * service-discovery endpoints (pure discovery, never principal-level data) and
 * OPTIONS (RFC 4918 §10.1 — clients use it pre-auth to discover server
 * capabilities). Without this gate, parseDavPath and the per-method handlers
 * can leak resource topology to anonymous probes via 404 / 405 responses.
 */
const requiresAuth = (url: URL, method: string): boolean =>
	method !== "OPTIONS" &&
	!WELL_KNOWN_PATHS.has(url.pathname.replace(TRAILING_SLASH, ""));

/** The admin handler owning a path kind and method, when the admin routes own it */
const adminMethodHandler = (
	kind: string,
	method: string,
): MethodHandlers[string] | undefined => {
	if (USER_ADMIN_KINDS.has(kind)) {
		return USER_METHOD_HANDLERS[method];
	}
	return GROUP_ADMIN_KINDS.has(kind)
		? GROUP_METHOD_HANDLERS[method]
		: undefined;
};

export const davRouter = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<Response, AppError, DavServices> => {
	// RFC 4918 §5.2: when a collection is addressed without a trailing slash
	// the server MAY handle the request anyway, and in that case SHOULD return
	// a Content-Location header pointing to the canonical (with-slash) URL.
	// Captured here so the post-processor below can see what parseDavPath
	// resolved without complicating every per-method return.
	let resolvedCollectionKind = false;
	return Effect.gen(function* () {
		const method = req.method.toUpperCase();

		// Failing with AuthError lets the outer HTTP edge attach the right
		// WWW-Authenticate header (only when basic auth is enabled).
		if (requiresAuth(ctx.url, method) && ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}

		const path = yield* parseDavPath(ctx.url).pipe(
			Effect.withSpan("dav.parse_path", {
				attributes: { "http.path": ctx.url.pathname },
			}),
		);
		resolvedCollectionKind = COLLECTION_KINDS.has(path.kind);

		yield* Effect.annotateCurrentSpan({
			"dav.path_kind": path.kind,
			"dav.method": method,
		});
		yield* Effect.logTrace("dav.route: dispatching", {
			kind: path.kind,
			method,
		});

		// RFC 6764 §5: /.well-known/caldav and /.well-known/carddav must redirect
		// to the DAV context path so clients can perform service discovery.
		if (path.kind === "wellknown") {
			yield* Effect.logTrace("dav.route: well-known redirect", {
				name: path.name,
			});
			return new Response(null, {
				status: 301,
				headers: { Location: "/dav/" },
			});
		}

		// Track the dispatched DAV request
		yield* Metric.update(
			Metric.withAttributes(davRequestsTotal, {
				"dav.method": method,
				"dav.path_kind": path.kind,
			}),
			1,
		);

		if (path.kind === "unknownPrincipal") {
			yield* Effect.logDebug("dav.route: unknown principal", {
				method,
				path: ctx.url.pathname,
			});
			return yield* Effect.fail(unknownPrincipalError(method));
		}

		// Dispatch user/group admin paths first before the principal/collection handlers
		const adminHandler = adminMethodHandler(path.kind, method);
		if (adminHandler !== undefined) {
			return yield* adminHandler(path, ctx, req);
		}

		if (path.kind === "collectionHome") {
			const homeHandler = COLLECTION_HOME_METHOD_HANDLERS[method];
			if (homeHandler === undefined) {
				return methodNotAllowedResponse("OPTIONS, PROPFIND");
			}
			return yield* homeHandler(path, ctx, req);
		}

		const handler = DAV_METHOD_HANDLERS[method];
		if (handler === undefined) {
			yield* Effect.logInfo("dav.route: method not allowed", { method });
			return methodNotAllowedResponse(SUPPORTED_METHODS);
		}
		return yield* handler(path, ctx, req);
	}).pipe(
		Effect.catchTag("DavError", (err) => {
			// 401s propagate to the outer HTTP edge so it can attach the right
			// WWW-Authenticate header — basic auth only emits one when
			// basicAuthEnabled is true; proxy-only / AUTO_LOGIN-only deployments
			// must not advertise Basic to clients.
			if (err.status === HTTP_UNAUTHORIZED) {
				return Effect.fail(err);
			}
			const body = err.precondition
				? buildDavErrorBody(err.precondition)
				: null;
			const headers: Record<string, string> = body
				? { "Content-Type": "application/xml; charset=utf-8" }
				: {};
			return Effect.succeed(
				new Response(body, { status: err.status, headers }),
			);
		}),
		// RFC 4918 §5.2: if the client addressed a collection without a trailing
		// slash, point them at the canonical URL via Content-Location so caches
		// and follow-up clients converge on the with-slash form. Only applied
		// when parseDavPath resolved a collection kind; per-instance URLs are
		// excluded because they're not collections.
		Effect.map((response) => {
			if (
				!resolvedCollectionKind ||
				ctx.url.pathname.endsWith("/") ||
				response.headers.has("Content-Location")
			) {
				return response;
			}
			const canonical = `${ctx.url.origin}${ctx.url.pathname}/${ctx.url.search}`;
			const next = new Response(response.body, response);
			next.headers.set("Content-Location", canonical);
			return next;
		}),
		Effect.withSpan("dav.route", {
			attributes: { "http.path": ctx.url.pathname },
		}),
	);
};
