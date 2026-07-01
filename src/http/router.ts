import { Effect, Match, Metric, Option } from "effect";
import { AuthService } from "#src/auth/service.ts";
import { AppConfigService } from "#src/config.ts";
import type { DatabaseClient } from "#src/db/client.ts";
import type { AppError } from "#src/domain/errors.ts";
import {
	type HttpRequestContext,
	newRequestId,
	RequestIdRef,
} from "#src/http/context.ts";
import { davRouter } from "#src/http/dav/router.ts";
import { buildXml } from "#src/http/dav/xml/builder.ts";
import { feedHandler, isFeedPath } from "#src/http/feed/handler.ts";
import { resolveForwardedUrl } from "#src/http/forwarded-url.ts";
import { computeSmtpProxyOverride } from "#src/http/smtp-headers-apply.ts";
import { SmtpProxyOverrideRef } from "#src/http/smtp-headers-ref.ts";
import {
	HTTP_BAD_REQUEST,
	HTTP_INTERNAL_SERVER_ERROR,
	HTTP_UNAUTHORIZED,
} from "#src/http/status.ts";
import { timezonesHandler } from "#src/http/timezones/handler.ts";
import { uiRouter } from "#src/http/ui/router.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import type {
	CollectionRepository,
	IanaTimezoneService,
	InstanceRepository,
	PrincipalRepository,
	SchedulingService,
} from "#src/layers.ts";
import {
	httpRequestDurationMs,
	httpRequestsTotal,
	trackDuration,
} from "#src/observability/metrics.ts";
import type { FileService } from "#src/platform/file.ts";
import type { AclService } from "#src/services/acl/index.ts";
import type { AclRepository } from "#src/services/acl/repository.ts";
import type { AppPasswordService } from "#src/services/app-password/service.ts";
import type { CalEditService } from "#src/services/cal-edit/service.ts";
import type { CalIndexRepository } from "#src/services/cal-index/index.ts";
import type { CardEditService } from "#src/services/card-edit/service.ts";
import type { CardIndexRepository } from "#src/services/card-index/index.ts";
import type { CollectionService } from "#src/services/collection/index.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { ContactCleanupService } from "#src/services/contact-cleanup/service.ts";
import type { ContactMergeService } from "#src/services/contact-merge/service.ts";
import type { UserEmailCredentialRepository } from "#src/services/email-credential/repository.ts";
import type { EmailCredentialService } from "#src/services/email-credential/service.ts";
import type { EntityRepository } from "#src/services/entity/index.ts";
import type { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import type { SubscriptionService } from "#src/services/external-calendar/subscription.ts";
import type {
	GroupRepository,
	GroupService,
} from "#src/services/group/index.ts";
import type { ImipDispatchService } from "#src/services/imip/dispatch.ts";
import type { InstanceService } from "#src/services/instance/index.ts";
import type { OidcService } from "#src/services/oidc/service.ts";
import type { PrincipalService } from "#src/services/principal/service.ts";
import type { ProvisioningService } from "#src/services/provisioning/service.ts";
import type { OidcLoginRepository } from "#src/services/session/oidc-login-repository.ts";
import type { SessionService } from "#src/services/session/service.ts";
import type { ShareLinkService } from "#src/services/share-link/service.ts";
import type { CalTimezoneRepository } from "#src/services/timezone/index.ts";
import type { TombstoneRepository } from "#src/services/tombstone/index.ts";
import type { UserRepository, UserService } from "#src/services/user/index.ts";

// ---------------------------------------------------------------------------
// Top-level HTTP router
//
// Responsibilities:
//   1. Assign requestId, annotate logs
//   2. Authenticate the request
//   3. Route to DAV, timezone service, or UI based on path prefix
//   4. Map all errors to HTTP responses
//   5. Track HTTP request metrics and duration
// ---------------------------------------------------------------------------

type AppServices =
	| AppConfigService
	| AuthService
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
	| OidcService
	| OidcLoginRepository
	| SessionService
	| AppPasswordService
	| GroupRepository
	| UserService
	| GroupService
	| SchedulingService
	| FileService
	| TemplateService
	| ProvisioningService
	| ExternalCalendarRepository
	| AclRepository
	| CalEditService
	| CardEditService
	| ContactCleanupService
	| ContactMergeService
	| EmailCredentialService
	| ImipDispatchService
	| UserEmailCredentialRepository
	| SubscriptionService
	| ShareLinkService;

const isDavPath = (pathname: string): boolean =>
	pathname === "/dav" ||
	pathname.startsWith("/dav/") ||
	pathname.startsWith("/.well-known/cal") ||
	pathname.startsWith("/.well-known/card");

const isTimezonePath = (pathname: string): boolean => pathname === "/timezones";

const isUiPath = (pathname: string): boolean =>
	pathname === "/" ||
	pathname === "/ui" ||
	pathname.startsWith("/ui/") ||
	pathname.startsWith("/static/");

/** Coarse path group for metric tagging — stable cardinality. */
const pathGroup = (pathname: string): string => {
	if (isDavPath(pathname)) {
		return "dav";
	}
	if (isTimezonePath(pathname)) {
		return "timezones";
	}
	if (isUiPath(pathname)) {
		return "ui";
	}
	if (isFeedPath(pathname)) {
		return "feed";
	}
	return "unknown";
};

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
	return [
		"D",
		precondition.startsWith("DAV:")
			? precondition.slice("DAV:".length)
			: precondition,
	];
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
const mapErrorToResponse = (
	err: AppError,
	basicAuthEnabled: boolean,
): Effect.Effect<Response, never> =>
	Match.value(err).pipe(
		Match.tag("DavError", (e) => {
			// 401s — from davRouter's central auth gate or per-handler
			// `unauthorized()` — surface as DavError today. Honour the
			// `basicAuthEnabled` toggle the same way we do for AuthError so
			// proxy-only / AUTO_LOGIN-only deployments don't falsely advertise
			// Basic in their challenge.
			if (e.status === HTTP_UNAUTHORIZED) {
				return Effect.succeed(
					new Response(e.message ?? null, {
						status: HTTP_UNAUTHORIZED,
						headers: basicAuthEnabled
							? { "WWW-Authenticate": 'Basic realm="shuriken"' }
							: {},
					}),
				);
			}
			return e.precondition
				? Effect.flatMap(davErrorBody(e.precondition), (body) =>
						Effect.succeed(
							new Response(body, {
								status: e.status,
								headers: { "Content-Type": "application/xml; charset=utf-8" },
							}),
						),
					)
				: Effect.succeed(new Response(e.message ?? null, { status: e.status }));
		}),
		Match.tag("AuthError", () =>
			Effect.succeed(
				new Response("Unauthorized", {
					status: HTTP_UNAUTHORIZED,
					headers: basicAuthEnabled
						? { "WWW-Authenticate": 'Basic realm="shuriken"' }
						: {},
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
			Effect.succeed(
				new Response("Internal Server Error", { status: 500 }),
			).pipe(
				Effect.tap(() =>
					Effect.logError("request failed with internal error", {
						cause: e.cause,
					}),
				),
			),
		),
		Match.tag("ConfigError", (e) =>
			Effect.succeed(
				new Response("Internal Server Error", { status: 500 }),
			).pipe(
				Effect.tap(() =>
					Effect.logError("request failed with config error", { key: e.key }),
				),
			),
		),
		Match.exhaustive,
	);

/**
 * Main request handler — entry point for every HTTP request.
 *
 * @param req           The incoming Request
 * @param clientAddress The client IP, resolved from the transport at the edge,
 *                      or undefined when unavailable.
 */
export const handleRequest = (
	req: Request,
	clientAddress: string | undefined,
): Effect.Effect<Response, never, AppServices> => {
	const requestId = newRequestId();
	const clientIp = Option.fromNullishOr(clientAddress);
	const url = new URL(req.url);

	// Liveness/readiness endpoint: a public, dependency-free 200, handled before
	// auth, metrics, and tracing. Container probes (kubelet) can't carry proxy or
	// basic credentials and follow same-host redirects, so they can't use the DAV
	// discovery paths (/.well-known/{cal,card}dav) — those 301-redirect into
	// /dav/, which requires auth and answers 401 to an unauthenticated probe.
	if (url.pathname === "/healthz") {
		return Effect.succeed(new Response("ok", { status: 200 }));
	}

	const group = pathGroup(url.pathname);

	// Pre-tagged metric instances (method + path_group are stable for this request)
	const requestCounter = Metric.withAttributes(httpRequestsTotal, {
		"http.method": req.method,
		"http.path_group": group,
	});
	const durationHistogram = Metric.withAttributes(httpRequestDurationMs, {
		"http.method": req.method,
		"http.path_group": group,
	});

	return Effect.gen(function* () {
		yield* Effect.logTrace("request received", {
			method: req.method,
			path: url.pathname,
			clientIp: Option.getOrUndefined(clientIp),
		});

		// Public unauthenticated feed endpoint — must be handled before auth so
		// the share-link token (not basic/proxy credentials) authorizes the read.
		if (isFeedPath(url.pathname)) {
			return yield* feedHandler(req, url);
		}

		const authService = yield* AuthService;
		const auth = yield* authService.authenticate(req.headers, clientIp);

		// Transient SMTP creds — only honoured from a trusted proxy. Provided via
		// SmtpProxyOverrideRef for the duration of dispatch and picked up by
		// EmailCredentialService.resolveForUser.
		const cfg = yield* AppConfigService;
		const smtpOverride = computeSmtpProxyOverride(req.headers, clientIp, cfg);

		// Externally-visible URL — corrects scheme/host from a trusted proxy's
		// X-Forwarded-* headers so every absolute href we emit (DAV responses,
		// timezone service, Location headers, web UI) matches the public URL
		// rather than the internal http hop Deno.serve sees.
		const publicUrl = resolveForwardedUrl(
			url,
			req.headers,
			clientIp,
			cfg.auth.trustedProxies,
		);

		const caldavTimezones = req.headers.get("CalDAV-Timezones") as
			| "T"
			| "F"
			| null;

		const ctx: HttpRequestContext = {
			requestId,
			method: req.method,
			url: publicUrl,
			headers: req.headers,
			auth,
			clientIp,
			caldavTimezones,
		};

		const dispatch = Effect.gen(function* () {
			if (isDavPath(url.pathname)) {
				return yield* davRouter(req, ctx);
			}

			if (isTimezonePath(url.pathname)) {
				return yield* timezonesHandler(req, publicUrl);
			}

			if (isUiPath(url.pathname)) {
				return yield* uiRouter(req, ctx);
			}

			yield* Effect.logDebug("no route matched", { path: url.pathname });
			return new Response("Not Found", { status: 404 });
		});

		return yield* dispatch.pipe(
			Effect.provideService(SmtpProxyOverrideRef, smtpOverride),
		);
	}).pipe(
		Effect.provideService(RequestIdRef, Option.some(requestId)),
		Effect.annotateLogs({
			requestId,
			"http.method": req.method,
			"http.path": url.pathname,
		}),
		Effect.catch((err) =>
			Effect.flatMap(AppConfigService, (cfg) =>
				mapErrorToResponse(err, cfg.auth.basicAuthEnabled),
			),
		),
		Effect.tap((response) => {
			const status = response.status;
			return Effect.all(
				[
					status >= HTTP_INTERNAL_SERVER_ERROR
						? Effect.logWarning("request complete", { status })
						: status >= HTTP_BAD_REQUEST
							? Effect.logDebug("request complete", { status })
							: Effect.logTrace("request complete", { status }),
					Metric.update(
						Metric.withAttributes(requestCounter, {
							"http.status_code": String(status),
						}),
						1,
					),
				],
				{ discard: true },
			);
		}),
		trackDuration(durationHistogram),
		Effect.withSpan("http.request", {
			attributes: {
				"http.method": req.method,
				"http.path": url.pathname,
				"http.path_group": group,
				"http.client_ip": Option.getOrElse(clientIp, () => ""),
				"request.id": requestId,
			},
		}),
	);
};
