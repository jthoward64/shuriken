import { Effect, Layer, Option, Redacted, Ref } from "effect";
import { Temporal } from "temporal-polyfill";
import { authenticateBasic, parseBasicAuth } from "#src/auth/layers/basic.ts";
import { resolveAutoLoginPrincipal } from "#src/auth/layers/single-user.ts";
import {
	emptyRateLimitState,
	isRateLimited,
	type RateLimitConfig,
	type RateLimitState,
	recordFailure,
} from "#src/auth/rate-limit.ts";
import { AuthService } from "#src/auth/service.ts";
import { AppConfigService } from "#src/config.ts";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import {
	Authenticated,
	type AuthResult,
	Unauthenticated,
} from "#src/domain/types/dav.ts";
import { Email } from "#src/domain/types/strings.ts";
import { getCookie, SESSION_COOKIE } from "#src/http/cookie.ts";
import {
	CryptoService,
	type CryptoServiceShape,
} from "#src/platform/crypto.ts";
import {
	SessionService,
	type SessionServiceShape,
} from "#src/services/session/service.ts";

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

/** Everything the composite's three methods need, resolved once at layer build */
interface CompositeDeps {
	readonly db: DbClient;
	readonly crypto: CryptoServiceShape;
	readonly sessions: SessionServiceShape;
	readonly autoLoginEmail: Option.Option<Email>;
	readonly basicAuthEnabled: boolean;
	readonly rateLimitConfig: RateLimitConfig;
	readonly rateLimitState: Ref.Ref<RateLimitState>;
}

/** Step 2: resolve a web-UI session cookie, when the request carries one */
const authenticateSession = Effect.fn("auth.composite.session")(function* (
	deps: CompositeDeps,
	headers: Headers,
) {
	const sessionToken = getCookie(headers, SESSION_COOKIE);
	if (Option.isNone(sessionToken)) {
		return Option.none<AuthResult>();
	}
	const principalOpt = yield* deps.sessions.validate(
		Redacted.make(sessionToken.value),
	);
	if (Option.isNone(principalOpt)) {
		return Option.none<AuthResult>();
	}
	yield* Effect.annotateCurrentSpan({ "auth.mode": "session" });
	return Option.some<AuthResult>(
		new Authenticated({ principal: principalOpt.value }),
	);
});

/**
 * Step 3: Basic auth, rate-limited per client IP.
 *
 * The rate limit only counts requests that actually carry Basic credentials. A
 * credential-less request is a client that hasn't been challenged yet, not a
 * failed attempt — challenge-based clients (browsers, python-caldav, many DAV
 * clients) always probe unauthenticated first, and counting those probes would
 * let such a client lock its own IP out before it ever sends a password.
 */
const authenticateBasicStep = Effect.fn("auth.composite.basic")(function* (
	deps: CompositeDeps,
	headers: Headers,
	clientIp: Option.Option<string>,
) {
	const hasCredentials = Option.isSome(parseBasicAuth(headers));
	const rateLimitKey = Option.getOrElse(clientIp, () => "unknown");
	const now = Temporal.Now.instant();

	if (hasCredentials) {
		const blocked = isRateLimited(
			yield* Ref.get(deps.rateLimitState),
			rateLimitKey,
			now,
			deps.rateLimitConfig,
		);
		if (blocked) {
			yield* Effect.logWarning(
				"auth.composite: rate-limited basic-auth attempt",
				{ clientIp: rateLimitKey },
			);
			return Option.some<AuthResult>(new Unauthenticated());
		}
	}

	const result = yield* authenticateBasic(headers).pipe(
		Effect.provideService(DatabaseClient, deps.db),
		Effect.provideService(CryptoService, deps.crypto),
	);
	if (result._tag === "Authenticated") {
		return Option.some<AuthResult>(result);
	}
	if (hasCredentials) {
		yield* Ref.update(deps.rateLimitState, (state) =>
			recordFailure(state, rateLimitKey, now, deps.rateLimitConfig),
		);
	}
	return Option.none<AuthResult>();
});

/** Run every enabled method in priority order; the first Authenticated wins */
const authenticateComposite = Effect.fn("auth.composite.authenticate")(
	function* (
		deps: CompositeDeps,
		headers: Headers,
		clientIp: Option.Option<string>,
	) {
		yield* Effect.annotateCurrentSpan({ "auth.mode": "composite" });

		// 1. AUTO_LOGIN — short-circuit when configured
		if (Option.isSome(deps.autoLoginEmail)) {
			yield* Effect.logTrace("auth.composite: auto-login");
			const principal = yield* resolveAutoLoginPrincipal(
				deps.db,
				deps.autoLoginEmail,
			);
			return new Authenticated({ principal });
		}

		// 2. Session cookie — only when one is present
		const session = yield* authenticateSession(deps, headers);
		if (Option.isSome(session)) {
			return session.value;
		}

		// 3. Basic auth - when enabled
		if (deps.basicAuthEnabled) {
			const basic = yield* authenticateBasicStep(deps, headers, clientIp);
			if (Option.isSome(basic)) {
				return basic.value;
			}
		}

		return new Unauthenticated();
	},
);

export const CompositeAuthLayer = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const {
			auth: {
				autoLogin,
				basicAuthEnabled,
				authRateLimitMaxAttempts,
				authRateLimitWindowS,
			},
		} = yield* AppConfigService;

		const deps: CompositeDeps = {
			db: yield* DatabaseClient,
			crypto: yield* CryptoService,
			sessions: yield* SessionService,
			autoLoginEmail: Option.map(autoLogin, Email),
			basicAuthEnabled,
			rateLimitConfig: {
				maxAttempts: authRateLimitMaxAttempts,
				windowSeconds: authRateLimitWindowS,
			},
			rateLimitState: yield* Ref.make<RateLimitState>(emptyRateLimitState),
		};

		return {
			authenticate: (headers, clientIp) =>
				authenticateComposite(deps, headers, clientIp),
		};
	}),
);
