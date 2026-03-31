import { eq } from "drizzle-orm";
import { Config, Effect, Layer } from "effect";
import { AuthService } from "#/auth/service.ts";
import { DatabaseClient } from "#/db/client.ts";
import { user } from "#/db/drizzle/schema/index.ts";
import { databaseError } from "#/domain/errors.ts";
import { PrincipalId, UserId } from "#/domain/ids.ts";
import type { AuthResult } from "#/domain/types/dav.ts";

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
	clientIp: string | null,
	trustedProxies: string,
): boolean => {
	if (trustedProxies === "*") return true;
	if (!clientIp) return false;
	return trustedProxies
		.split(",")
		.map((s) => s.trim())
		.includes(clientIp);
};

export const ProxyAuthLayer = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		const proxyHeader = yield* Config.string("PROXY_HEADER").pipe(
			Config.withDefault("X-Remote-User"),
		);
		const trustedProxies = yield* Config.string("TRUSTED_PROXIES").pipe(
			Config.withDefault("*"),
		);

		return AuthService.of({
			authenticate: (headers, clientIp) =>
				Effect.gen(function* (): Effect.Effect<
					AuthResult,
					import("#/domain/errors.ts").DatabaseError
				> {
					// If the request doesn't come from a trusted proxy, ignore the header
					if (!isClientTrusted(clientIp, trustedProxies)) {
						return { _tag: "Unauthenticated" };
					}

					const username = headers.get(proxyHeader);
					if (!username) return { _tag: "Unauthenticated" };

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
						catch: (e) => databaseError(e),
					});

					const row = rows[0];
					if (!row) return { _tag: "Unauthenticated" };

					return {
						_tag: "Authenticated",
						principal: {
							principalId: PrincipalId(row.principalId),
							userId: UserId(row.userId),
							displayName: row.name,
						},
					};
				}),
		});
	}),
);
