import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import { AppConfigService } from "#src/config.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	HTTP_BAD_GATEWAY,
	HTTP_NOT_FOUND,
	HTTP_SEE_OTHER,
} from "#src/http/status.ts";
import {
	oidcRedirectUri,
	sanitizeReturnTo,
} from "#src/http/ui/handlers/auth/helpers.ts";
import { OidcService } from "#src/services/oidc/service.ts";
import { OidcLoginRepository } from "#src/services/session/oidc-login-repository.ts";

// ---------------------------------------------------------------------------
// GET /ui/auth/login — start the OIDC authorization-code flow.
//
// Mints PKCE/state/nonce, persists them keyed by `state`, and redirects the
// browser to the provider. The post-login destination (`returnTo`) is taken
// from the query string, constrained to a same-site path.
// ---------------------------------------------------------------------------

const PENDING_LOGIN_TTL_MINUTES = 10;

export const loginHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DatabaseError,
	AppConfigService | OidcService | OidcLoginRepository
> =>
	Effect.gen(function* () {
		const cfg = yield* AppConfigService;
		if (!cfg.auth.oidcEnabled) {
			return new Response("OIDC login is not enabled", {
				status: HTTP_NOT_FOUND,
			});
		}

		const oidc = yield* OidcService;
		const loginRepo = yield* OidcLoginRepository;

		const redirectUri = oidcRedirectUri(ctx.url.origin, cfg);
		const returnTo = sanitizeReturnTo(ctx.url.searchParams.get("returnTo"));

		const start = yield* oidc.beginLogin({ redirectUri }).pipe(
			Effect.catchTag("OidcError", (e) =>
				Effect.as(
					Effect.logWarning("auth.oidc: beginLogin failed", {
						reason: e.reason,
					}),
					null,
				),
			),
		);
		if (start === null) {
			return new Response("Sign-in is temporarily unavailable", {
				status: HTTP_BAD_GATEWAY,
			});
		}

		yield* loginRepo.create({
			state: start.state,
			pkceVerifier: start.pkceVerifier,
			nonce: start.nonce,
			returnTo,
			expiresAt: Temporal.Now.instant().add({
				minutes: PENDING_LOGIN_TTL_MINUTES,
			}),
		});

		return new Response(null, {
			status: HTTP_SEE_OTHER,
			headers: { Location: start.authorizationUrl },
		});
	});
