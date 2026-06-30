import { Effect, Option, Redacted } from "effect";
import { Temporal } from "temporal-polyfill";
import { AppConfigService } from "#src/config.ts";
import type {
	ConflictError,
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { SESSION_COOKIE, serializeCookie } from "#src/http/cookie.ts";
import {
	HTTP_BAD_GATEWAY,
	HTTP_BAD_REQUEST,
	HTTP_FORBIDDEN,
	HTTP_SEE_OTHER,
} from "#src/http/status.ts";
import {
	isSecureRequest,
	oidcRedirectUri,
} from "#src/http/ui/handlers/auth/helpers.ts";
import { resolveOidcPrincipal } from "#src/services/oidc/map-user.ts";
import { OidcService } from "#src/services/oidc/service.ts";
import type { ProvisioningService } from "#src/services/provisioning/service.ts";
import { OidcLoginRepository } from "#src/services/session/oidc-login-repository.ts";
import { SessionService } from "#src/services/session/service.ts";
import type { UserRepository } from "#src/services/user/repository.ts";

const SECONDS_PER_DAY = 86_400;

// ---------------------------------------------------------------------------
// GET /ui/auth/callback — finish the OIDC flow and start a session.
//
// Validates the `state` against a stored (single-use) pending login, exchanges
// the code (which validates PKCE/nonce/ID-token), maps the verified claims to a
// local user (linking or provisioning), issues a session, and sets the cookie.
// ---------------------------------------------------------------------------

export const callbackHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	ConflictError | DatabaseError | DavError | InternalError,
	| AppConfigService
	| OidcService
	| OidcLoginRepository
	| ProvisioningService
	| SessionService
	| UserRepository
> =>
	Effect.gen(function* () {
		const cfg = yield* AppConfigService;
		const oidc = yield* OidcService;
		const loginRepo = yield* OidcLoginRepository;
		const sessions = yield* SessionService;

		const state = ctx.url.searchParams.get("state");
		if (state === null) {
			return new Response("Missing state", { status: HTTP_BAD_REQUEST });
		}

		const pendingOpt = yield* loginRepo.consume(state);
		if (Option.isNone(pendingOpt)) {
			return new Response("Unknown or expired sign-in attempt", {
				status: HTTP_BAD_REQUEST,
			});
		}
		const pending = pendingOpt.value;
		if (
			Temporal.Instant.compare(pending.expiresAt, Temporal.Now.instant()) <= 0
		) {
			return new Response("Sign-in attempt expired", {
				status: HTTP_BAD_REQUEST,
			});
		}

		const claims = yield* oidc
			.completeLogin({
				currentUrl: ctx.url,
				redirectUri: oidcRedirectUri(ctx.url.origin, cfg),
				state,
				nonce: pending.nonce,
				pkceVerifier: pending.pkceVerifier,
			})
			.pipe(
				Effect.catchTag("OidcError", (e) =>
					Effect.as(
						Effect.logWarning("auth.oidc: completeLogin failed", {
							reason: e.reason,
						}),
						null,
					),
				),
			);
		if (claims === null) {
			return new Response("Sign-in failed", { status: HTTP_BAD_GATEWAY });
		}

		const principalOpt = yield* resolveOidcPrincipal(claims, {
			autoProvision: cfg.auth.oidcAutoProvision,
		});
		if (Option.isNone(principalOpt)) {
			return new Response("No account is associated with this login.", {
				status: HTTP_FORBIDDEN,
			});
		}

		const issued = yield* sessions.create({
			userId: principalOpt.value.userId,
			userAgent: Option.fromNullishOr(ctx.headers.get("user-agent")),
			ip: ctx.clientIp,
		});

		const cookie = serializeCookie(
			SESSION_COOKIE,
			Redacted.value(issued.token),
			{
				secure: isSecureRequest(ctx.url),
				maxAgeSeconds: cfg.auth.sessionTtlDays * SECONDS_PER_DAY,
			},
		);

		return new Response(null, {
			status: HTTP_SEE_OTHER,
			headers: { Location: pending.returnTo, "Set-Cookie": cookie },
		});
	});
