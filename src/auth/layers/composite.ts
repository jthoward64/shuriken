import { Effect, Layer, Option, Redacted, Ref } from "effect";
import { Temporal } from "temporal-polyfill";
import { authenticateBasic, parseBasicAuth } from "#src/auth/layers/basic.ts";
import { resolveAutoLoginPrincipal } from "#src/auth/layers/single-user.ts";
import {
	emptyRateLimitState,
	isRateLimited,
	type RateLimitState,
	recordFailure,
} from "#src/auth/rate-limit.ts";
import { AuthService } from "#src/auth/service.ts";
import { AppConfigService } from "#src/config.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { Authenticated, Unauthenticated } from "#src/domain/types/dav.ts";
import { Email } from "#src/domain/types/strings.ts";
import { getCookie, SESSION_COOKIE } from "#src/http/cookie.ts";
import { CryptoService } from "#src/platform/crypto.ts";
import { SessionService } from "#src/services/session/service.ts";

// ---------------------------------------------------------------------------
// Composite auth layer
//
// All enabled methods run on every request in priority order:
//
//   1. AUTO_LOGIN        — if set, the configured user is always returned;
//                          no headers are inspected and no other method runs.
//   2. Session cookie    — a valid web-UI session (issued after OIDC login)
//                          resolves to its user. DAV clients never send the
//                          cookie, so this is a no-op for them.
//   3. BASIC_AUTH        — basic auth: Authorization header verified against a
//                          local password or an app-password credential.
//
// The first method that returns Authenticated wins. If none authenticate, the
// composite returns Unauthenticated and the HTTP edge maps to 401.
// ---------------------------------------------------------------------------

export const CompositeAuthLayer = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		const crypto = yield* CryptoService;
		const sessions = yield* SessionService;
		const {
			auth: {
				autoLogin,
				basicAuthEnabled,
				authRateLimitMaxAttempts,
				authRateLimitWindowS,
			},
		} = yield* AppConfigService;

		const autoLoginEmail = Option.map(autoLogin, Email);
		const rateLimitConfig = {
			maxAttempts: authRateLimitMaxAttempts,
			windowSeconds: authRateLimitWindowS,
		};
		const rateLimitState = yield* Ref.make<RateLimitState>(emptyRateLimitState);

		return {
			authenticate: Effect.fn("auth.composite.authenticate")(
				function* (headers, clientIp) {
					yield* Effect.annotateCurrentSpan({ "auth.mode": "composite" });

					// 1. AUTO_LOGIN — short-circuit when configured
					if (Option.isSome(autoLoginEmail)) {
						yield* Effect.logTrace("auth.composite: auto-login");
						const principal = yield* resolveAutoLoginPrincipal(
							db,
							autoLoginEmail,
						);
						return new Authenticated({ principal });
					}

					// 2. Session cookie — only when one is present
					const sessionToken = getCookie(headers, SESSION_COOKIE);
					if (Option.isSome(sessionToken)) {
						const principalOpt = yield* sessions.validate(
							Redacted.make(sessionToken.value),
						);
						if (Option.isSome(principalOpt)) {
							yield* Effect.annotateCurrentSpan({ "auth.mode": "session" });
							return new Authenticated({ principal: principalOpt.value });
						}
					}

					// 3. Basic auth — when enabled, rate-limited per client IP.
					//
					// The rate limit only counts requests that actually carry Basic
					// credentials. A credential-less request is a client that hasn't
					// been challenged yet, not a failed attempt — challenge-based
					// clients (browsers, python-caldav, many DAV clients) always probe
					// unauthenticated first, and counting those probes would let such a
					// client lock its own IP out before it ever sends a password.
					if (basicAuthEnabled) {
						const hasCredentials = Option.isSome(parseBasicAuth(headers));
						const rateLimitKey = Option.getOrElse(clientIp, () => "unknown");
						const now = Temporal.Now.instant();

						if (hasCredentials) {
							const blocked = isRateLimited(
								yield* Ref.get(rateLimitState),
								rateLimitKey,
								now,
								rateLimitConfig,
							);
							if (blocked) {
								yield* Effect.logWarning(
									"auth.composite: rate-limited basic-auth attempt",
									{ clientIp: rateLimitKey },
								);
								return new Unauthenticated();
							}
						}

						const result = yield* authenticateBasic(headers).pipe(
							Effect.provideService(DatabaseClient, db),
							Effect.provideService(CryptoService, crypto),
						);
						if (result._tag === "Authenticated") {
							return result;
						}
						if (hasCredentials) {
							yield* Ref.update(rateLimitState, (s) =>
								recordFailure(s, rateLimitKey, now, rateLimitConfig),
							);
						}
					}

					return new Unauthenticated();
				},
			),
		};
	}),
);
