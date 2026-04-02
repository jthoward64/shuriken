import { eq } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { AuthService } from "#src/auth/service.ts";
import { AppConfigService } from "#src/config.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { user } from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import { PrincipalId, UserId } from "#src/domain/ids.ts";
import {
	Authenticated,
	type AuthResult,
	Unauthenticated,
} from "#src/domain/types/dav.ts";

// ---------------------------------------------------------------------------
// Proxy auth layer
//
// Trusts a reverse proxy to handle authentication. The proxy injects the
// authenticated username via a configurable header (default: X-Remote-User).
//
// Trusted-proxy checking is performed per-request based on client IP.
// TRUSTED_PROXIES="*"  → trust all (default)
// TRUSTED_PROXIES="127.0.0.1,::1" → exact IP match (CIDR not yet supported)
// ---------------------------------------------------------------------------

const isClientTrusted = (
	clientIp: Option.Option<string>,
	trustedProxies: string,
): boolean =>
	trustedProxies === "*" ||
	Option.match(clientIp, {
		onNone: () => false,
		onSome: (ip) =>
			trustedProxies
				.split(",")
				.map((s) => s.trim())
				.includes(ip),
	});

export const ProxyAuthLayer = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		const {
			auth: { proxyHeader, trustedProxies },
		} = yield* AppConfigService;

		return AuthService.of({
			authenticate: (
				headers,
				clientIp,
			): Effect.Effect<AuthResult, DatabaseError> =>
				Effect.gen(function* () {
					// If the request doesn't come from a trusted proxy, ignore the header
					if (!isClientTrusted(clientIp, trustedProxies)) {
						return new Unauthenticated();
					}

					const username = headers.get(proxyHeader);
					if (!username) {
						return new Unauthenticated();
					}

					const rows = yield* Effect.tryPromise({
						try: () =>
							db
								.select({
									userId: user.id,
									principalId: user.principalId,
									name: user.name,
								})
								.from(user)
								.where(eq(user.email, username))
								.limit(1),
						catch: (e) => new DatabaseError({ cause: e }),
					});

					const row = rows[0];
					if (!row) {
						return new Unauthenticated();
					}

					return new Authenticated({
						principal: {
							principalId: PrincipalId(row.principalId),
							userId: UserId(row.userId),
							displayName: row.name,
						},
					});
				}),
		});
	}),
);
