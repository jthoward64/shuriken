import { Effect, Match, Option } from "effect";
import { AuthService } from "#src/auth/service.ts";
import type { AppError } from "#src/domain/errors.ts";
import {
	type HttpRequestContext,
	newRequestId,
	setRequestId,
} from "#src/http/context.ts";
import { davRouter } from "#src/http/dav/router.ts";
import { buildXml } from "#src/http/dav/xml/builder.ts";
import {
	HTTP_BAD_REQUEST,
	HTTP_INTERNAL_SERVER_ERROR,
} from "#src/http/status.ts";
import { uiRouter } from "#src/http/ui/router.ts";
import type {
	CollectionRepository,
	InstanceRepository,
	PrincipalRepository,
} from "#src/layers.ts";
import type { AclService } from "#src/services/acl/index.ts";
import type { CollectionService } from "#src/services/collection/index.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { EntityRepository } from "#src/services/entity/index.ts";
import type { InstanceService } from "#src/services/instance/index.ts";
import type { PrincipalService } from "#src/services/principal/service.ts";
import type { CalTimezoneRepository } from "#src/services/timezone/index.ts";

// ---------------------------------------------------------------------------
// Top-level HTTP router
//
// Responsibilities:
//   1. Assign requestId, annotate logs
//   2. Authenticate the request
//   3. Route to DAV or UI based on path prefix
//   4. Map all errors to HTTP responses
// ---------------------------------------------------------------------------

type AppServices =
	| AuthService
	| PrincipalRepository
	| CollectionRepository
	| InstanceRepository
	| CollectionService
	| InstanceService
	| AclService
	| PrincipalService
	| EntityRepository
	| ComponentRepository
	| CalTimezoneRepository;

const isDavPath = (pathname: string): boolean =>
	pathname === "/dav" ||
	pathname.startsWith("/dav/") ||
	pathname.startsWith("/.well-known/cal") ||
	pathname.startsWith("/.well-known/card");

const isUiPath = (pathname: string): boolean =>
	pathname === "/" ||
	pathname === "/ui" ||
	pathname.startsWith("/ui/") ||
	pathname.startsWith("/static/");

/**
 * Split a DavPrecondition string into an XML namespace prefix and local name.
 * All DavPrecondition values follow the "NS:local-name" pattern enforced by
 * the compile-time assertion in errors.ts.
 */
const splitPrecondition = (
	precondition: string,
): ["D" | "C" | "CR", string] => {
	if (precondition.startsWith("CALDAV:")) {
		return ["C", precondition.slice("CALDAV:".length)];
	}
	if (precondition.startsWith("CARDDAV:")) {
		return ["CR", precondition.slice("CARDDAV:".length)];
	}
	// DAV: is the default; the compile-time assertion ensures no other prefix exists
	return ["D", precondition.startsWith("DAV:") ? precondition.slice("DAV:".length) : precondition];
};

/** Serialize a DavError to an RFC 4918 §16 XML body. */
const davErrorBody = (precondition: string): Effect.Effect<string, never> => {
	const [nsPrefix, localName] = splitPrecondition(precondition);

	const ns =
		nsPrefix === "D"
			? "DAV:"
			: nsPrefix === "C"
				? "urn:ietf:params:xml:ns:caldav"
				: "urn:ietf:params:xml:ns:carddav";

	const obj = {
		"D:error": {
			"@_xmlns:D": "DAV:",
			...(nsPrefix !== "D" ? { [`@_xmlns:${nsPrefix}`]: ns } : {}),
			[`${nsPrefix}:${localName}`]: "",
		},
	};

	return buildXml(obj);
};

/** Map any AppError to a Response. */
const mapErrorToResponse = (err: AppError): Effect.Effect<Response, never> =>
	Match.value(err).pipe(
		Match.tag("DavError", (e) =>
			e.precondition
				? Effect.flatMap(davErrorBody(e.precondition), (body) =>
						Effect.succeed(
							new Response(body, {
								status: e.status,
								headers: { "Content-Type": "application/xml; charset=utf-8" },
							}),
						),
					)
				: Effect.succeed(new Response(e.message ?? null, { status: e.status })),
		),
		Match.tag("AuthError", () =>
			Effect.succeed(
				new Response("Unauthorized", {
					status: 401,
					headers: { "WWW-Authenticate": 'Basic realm="shuriken"' },
				}),
			),
		),
		Match.tag("XmlParseError", () =>
			Effect.succeed(new Response("Bad Request: invalid XML", { status: 400 })),
		),
		Match.tag("ConflictError", (e) =>
			Effect.succeed(new Response(e.message, { status: 409 })),
		),
		Match.tag("DatabaseError", "InternalError", (e) =>
			Effect.succeed(new Response("Internal Server Error", { status: 500 })).pipe(
				Effect.tap(() => Effect.logWarning("server error", e.cause)),
			),
		),
		Match.tag("ConfigError", (e) =>
			Effect.succeed(new Response("Internal Server Error", { status: 500 })).pipe(
				Effect.tap(() => Effect.logWarning("config error", { key: e.key })),
			),
		),
		Match.exhaustive,
	);

/**
 * Main request handler — entry point for every HTTP request.
 *
 * @param req    The incoming Bun Request
 * @param server The Bun Server instance (used to get client IP)
 */
export const handleRequest = (
	req: Request,
	server: import("bun").Server<unknown>,
): Effect.Effect<Response, never, AppServices> => {
	const requestId = newRequestId();
	const clientIp = Option.fromNullable(server.requestIP(req)?.address);
	const url = new URL(req.url);

	return Effect.gen(function* () {
		yield* setRequestId(requestId);
		yield* Effect.logTrace("request received");

		const authService = yield* AuthService;
		const auth = yield* authService.authenticate(req.headers, clientIp);

		const ctx: HttpRequestContext = {
			requestId,
			method: req.method,
			url,
			headers: req.headers,
			auth,
			clientIp,
		};

		if (isDavPath(url.pathname)) {
			return yield* davRouter(req, ctx);
		}

		if (isUiPath(url.pathname)) {
			return yield* uiRouter(req);
		}

		yield* Effect.logDebug("no route matched");
		return new Response("Not Found", { status: 404 });
	}).pipe(
		Effect.annotateLogs({ requestId, method: req.method, path: url.pathname }),
		Effect.catchAll(mapErrorToResponse),
		Effect.tap((response) =>
			response.status >= HTTP_INTERNAL_SERVER_ERROR
				? Effect.logWarning("request failed", { status: response.status })
				: response.status >= HTTP_BAD_REQUEST
					? Effect.logDebug("request complete", { status: response.status })
					: Effect.logTrace("request complete", { status: response.status }),
		),
		Effect.withSpan("http.request", {
			attributes: { "http.method": req.method, "http.path": url.pathname },
		}),
	);
};
