import { Effect } from "effect";
import { AuthService } from "#/auth/service.ts";
import type { AppError } from "#/domain/errors.ts";
import type {
	CollectionRepository,
	InstanceRepository,
	PrincipalRepository,
} from "#/layers.ts";
import {
	setRequestId,
	newRequestId,
	type HttpRequestContext,
} from "#/http/context.ts";
import { uiRouter } from "#/http/ui/router.ts";
import { davRouter } from "#/http/dav/router.ts";
import { buildXml } from "#/http/dav/xml/builder.ts";

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
	| InstanceRepository;

const isDavPath = (pathname: string): boolean =>
	pathname.startsWith("/principals/") ||
	pathname.startsWith("/.well-known/cal") ||
	pathname.startsWith("/.well-known/card");

const isUiPath = (pathname: string): boolean =>
	pathname === "/" ||
	pathname === "/ui" ||
	pathname.startsWith("/ui/") ||
	pathname.startsWith("/static/");

/** Serialize a DavError to an RFC 4918 §16 XML body. */
const davErrorBody = (precondition: string): Effect.Effect<string, never> => {
	const [nsPrefix, localName] = precondition.includes("CALDAV:")
		? ["C", precondition.replace("CALDAV:", "")]
		: precondition.includes("CARDDAV:")
			? ["CR", precondition.replace("CARDDAV:", "")]
			: ["D", precondition.replace("DAV:", "")];

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
const mapErrorToResponse = (err: AppError): Effect.Effect<Response, never> => {
	switch (err._tag) {
		case "DavError": {
			if (!err.precondition) {
				return Effect.succeed(
					new Response(err.message ?? null, { status: err.status }),
				);
			}
			return Effect.flatMap(davErrorBody(err.precondition), (body) =>
				Effect.succeed(
					new Response(body, {
						status: err.status,
						headers: { "Content-Type": "application/xml; charset=utf-8" },
					}),
				),
			);
		}
		case "AuthError":
			return Effect.succeed(
				new Response("Unauthorized", {
					status: 401,
					headers: { "WWW-Authenticate": 'Basic realm="shuriken"' },
				}),
			);
		case "XmlParseError":
			return Effect.succeed(
				new Response("Bad Request: invalid XML", { status: 400 }),
			);
		case "DatabaseError":
		case "InternalError":
		case "ConfigError":
			return Effect.succeed(
				new Response("Internal Server Error", { status: 500 }),
			);
	}
};

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
	const clientIp = server.requestIP(req)?.address ?? null;
	const url = new URL(req.url);

	return Effect.gen(function* () {
		yield* setRequestId(requestId);

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

		return new Response("Not Found", { status: 404 });
	}).pipe(
		Effect.annotateLogs({ requestId, method: req.method, path: url.pathname }),
		Effect.catchAll(mapErrorToResponse),
	);
};
