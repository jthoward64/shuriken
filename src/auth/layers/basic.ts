import { and, eq } from "drizzle-orm";
import { Effect, Layer, Option, Redacted } from "effect";
import { AuthService } from "#src/auth/service.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { authUser, user } from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import { PrincipalId, UserId } from "#src/domain/ids.ts";
import {
	Authenticated,
	type AuthResult,
	Unauthenticated,
} from "#src/domain/types/dav.ts";
import { CryptoService } from "#src/platform/crypto.ts";

// ---------------------------------------------------------------------------
// Basic auth layer
//
// Parses HTTP Basic Authentication credentials, looks up the user in the
// auth_user table (authSource = "local"), and verifies the password.
// ---------------------------------------------------------------------------

const BASIC_PREFIX = "Basic ";

export const parseBasicAuth = (
	headers: Headers,
): Option.Option<{ username: string; password: Redacted.Redacted<string> }> => {
	const authorization = headers.get("Authorization");
	if (!authorization?.startsWith(BASIC_PREFIX)) {
		return Option.none();
	}

	const encoded = authorization.slice(BASIC_PREFIX.length);
	const decoded = atob(encoded);
	const colonIdx = decoded.indexOf(":");
	if (colonIdx === -1) {
		return Option.none();
	}

	return Option.some({
		username: decoded.slice(0, colonIdx),
		password: Redacted.make(decoded.slice(colonIdx + 1)),
	});
};

export const BasicAuthLayer = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		const crypto = yield* CryptoService;

		return AuthService.of({
			authenticate: Effect.fn("auth.authenticate")(function* (headers, _clientIp) {
				return yield* Option.match(parseBasicAuth(headers), {
					onNone: () =>
						Effect.logTrace("basic auth: no credentials").pipe(
							Effect.andThen(Effect.succeed<AuthResult>(new Unauthenticated())),
						),
					onSome: (creds) =>
						Effect.gen(function* () {
							yield* Effect.logTrace("basic auth attempt", {
								username: creds.username,
							});

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
								catch: (e) => new DatabaseError({ cause: e }),
							});

							const row = rows[0];
							if (!row?.authCredential) {
								yield* Effect.logDebug("basic auth: user not found", {
									username: creds.username,
								});
								return new Unauthenticated() as AuthResult;
							}

							// InternalError from Bun.password is a defect (unexpected), not a domain error
							const valid = yield* crypto
								.verifyPassword(creds.password, row.authCredential)
								.pipe(Effect.orDie);
							if (!valid) {
								yield* Effect.logDebug("basic auth: invalid password", {
									username: creds.username,
								});
								return new Unauthenticated() as AuthResult;
							}

							yield* Effect.logTrace("basic auth: succeeded", {
								userId: row.userId,
							});
							return new Authenticated({
								principal: {
									principalId: PrincipalId(row.principalId),
									userId: UserId(row.userId),
									displayName: row.name,
								},
							}) as AuthResult;
						}),
				});
			}),
		});
	}),
);
