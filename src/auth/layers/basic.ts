import { and, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { AuthService } from "#/auth/service.ts";
import { DatabaseClient } from "#/db/client.ts";
import { authUser, user } from "#/db/drizzle/schema/index.ts";
import {
	type AuthError,
	type DatabaseError,
	databaseError,
} from "#/domain/errors.ts";
import { PrincipalId, UserId } from "#/domain/ids.ts";
import type { AuthResult } from "#/domain/types/dav.ts";
import { CryptoService } from "#/platform/crypto.ts";

// ---------------------------------------------------------------------------
// Basic auth layer
//
// Parses HTTP Basic Authentication credentials, looks up the user in the
// auth_user table (authSource = "local"), and verifies the password.
// ---------------------------------------------------------------------------

const BASIC_PREFIX = "Basic ";

const parseBasicAuth = (
	headers: Headers,
): { username: string; password: string } | null => {
	const authorization = headers.get("Authorization");
	if (!authorization?.startsWith(BASIC_PREFIX)) { return null; }

	const encoded = authorization.slice(BASIC_PREFIX.length);
	const decoded = atob(encoded);
	const colonIdx = decoded.indexOf(":");
	if (colonIdx === -1) { return null; }

	return {
		username: decoded.slice(0, colonIdx),
		password: decoded.slice(colonIdx + 1),
	};
};

export const BasicAuthLayer = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		const crypto = yield* CryptoService;

		return AuthService.of({
			authenticate: (
				headers,
				_clientIp,
			): Effect.Effect<AuthResult, AuthError | DatabaseError> =>
				Effect.gen(function* () {
					const creds = parseBasicAuth(headers);
					if (!creds) { return { _tag: "Unauthenticated" }; }

					// Look up auth_user row for this username
					const rows = yield* Effect.tryPromise({
						try: () =>
							db
								.select({
									authCredential: authUser.authCredential,
									userId: user.id,
									principalId: user.principalId,
									name: user.name,
								})
								.from(authUser)
								.innerJoin(user, eq(authUser.userId, user.id))
								.where(
									and(
										eq(authUser.authSource, "local"),
										eq(authUser.authId, creds.username),
									),
								)
								.limit(1),
						catch: (e) => databaseError(e),
					});

					const row = rows[0];
					if (!row?.authCredential) { return { _tag: "Unauthenticated" }; }

					// InternalError from Bun.password is a defect (unexpected), not a domain error
					const valid = yield* crypto
						.verifyPassword(creds.password, row.authCredential)
						.pipe(Effect.orDie);
					if (!valid) { return { _tag: "Unauthenticated" }; }

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
