import { Effect, Layer, Option } from "effect";
import { authenticateBasic } from "#src/auth/layers/basic.ts";
import {
	authenticateProxy,
	type ProxyAutoProvisionOpts,
} from "#src/auth/layers/proxy.ts";
import { resolveAutoLoginPrincipal } from "#src/auth/layers/single-user.ts";
import { AuthService } from "#src/auth/service.ts";
import { AppConfigService } from "#src/config.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { Authenticated, Unauthenticated } from "#src/domain/types/dav.ts";
import { Email } from "#src/domain/types/strings.ts";
import { CryptoService } from "#src/platform/crypto.ts";
import { ProvisioningService } from "#src/services/provisioning/service.ts";

// ---------------------------------------------------------------------------
// Composite auth layer
//
// Replaces the old AUTH_MODE-driven single-strategy selection. All enabled
// methods run on every request in priority order:
//
//   1. AUTO_LOGIN          — if set, the configured user is always returned;
//                            no headers are inspected and no other method runs.
//   2. PROXY_HEADER (set)  — proxy auth: trusted-IP check, header lookup, DB lookup.
//   3. BASIC_AUTH_ENABLED  — basic auth: Authorization header, credential verify.
//
// The first method that returns Authenticated wins. If none authenticate, the
// composite returns Unauthenticated and the HTTP edge maps to 401.
// ---------------------------------------------------------------------------

export const CompositeAuthLayer = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		const crypto = yield* CryptoService;
		const provisioning = yield* ProvisioningService;
		const {
			auth: {
				autoLogin,
				proxyHeader,
				proxyRoleHeader,
				trustedProxies,
				basicAuthEnabled,
				proxyAutoProvision,
			},
		} = yield* AppConfigService;

		const autoLoginEmail = Option.map(autoLogin, Email);
		const provisionOpts: Option.Option<ProxyAutoProvisionOpts> =
			proxyAutoProvision
				? Option.some({
						autoProvision: true,
						roleHeader: proxyRoleHeader,
					})
				: Option.none();

		return AuthService.of({
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

					// 2. Proxy auth — when PROXY_HEADER is set
					if (Option.isSome(proxyHeader)) {
						const result = yield* authenticateProxy(
							headers,
							clientIp,
							proxyHeader.value,
							trustedProxies,
							provisionOpts,
						).pipe(
							Effect.provideService(DatabaseClient, db),
							Effect.provideService(ProvisioningService, provisioning),
						);
						if (result._tag === "Authenticated") {
							return result;
						}
					}

					// 3. Basic auth — when enabled
					if (basicAuthEnabled) {
						const result = yield* authenticateBasic(headers).pipe(
							Effect.provideService(DatabaseClient, db),
							Effect.provideService(CryptoService, crypto),
						);
						if (result._tag === "Authenticated") {
							return result;
						}
					}

					return new Unauthenticated();
				},
			),
		});
	}),
);
