import { and, eq } from "drizzle-orm";
import { Effect, Layer, Metric, Option, Redacted } from "effect";
import { AuthService } from "#src/auth/service.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { authUser, principal, user } from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import { PrincipalId, UserId } from "#src/domain/ids.ts";
import {
	Authenticated,
	type AuthResult,
	Unauthenticated,
} from "#src/domain/types/dav.ts";
import { authAttemptsTotal } from "#src/observability/metrics.ts";
import { CryptoService } from "#src/platform/crypto.ts";

// ---------------------------------------------------------------------------
// Basic auth layer
//
// Parses HTTP Basic Authentication credentials, looks up the user in the
// auth_user table (authSource = "local"), and verifies the password.
// ---------------------------------------------------------------------------

const BASIC_PREFIX = "Basic ";

const authCounter = Metric.tagged(authAttemptsTotal, "auth.mode", "basic");

export const parseBasicAuth = (
	headers: Headers,
): Option.Option<{ username: string; password: Redacted.Redacted<string> }> => {
	const authorization = headers.get("Authorization");
	if (!authorization?.startsWith(BASIC_PREFIX)) {
		return Option.none();
	}

	const encoded = authorization.slice(BASIC_PREFIX.length);
	let decoded: string;
	try {
		decoded = atob(encoded);
	} catch {
		return Option.none();
	}
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
			authenticate: Effect.fn("auth.basic.authenticate")(
				function* (headers, _clientIp) {
					yield* Effect.annotateCurrentSpan({ "auth.mode": "basic" });

					return yield* Option.match(parseBasicAuth(headers), {
						onNone: () =>
							Effect.gen(function* () {
								yield* Effect.logTrace("auth.basic: no credentials present");
								yield* Metric.increment(
									Metric.tagged(authCounter, "auth.outcome", "no_credentials"),
								);
								return new Unauthenticated() as AuthResult;
							}),
						onSome: (creds) =>
							Effect.gen(function* () {
								yield* Effect.annotateCurrentSpan({
									"auth.username": creds.username,
								});
								yield* Effect.logTrace("auth.basic: attempt", {
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
												displayName: principal.displayName,
											})
											.from(authUser)
											.innerJoin(user, eq(authUser.userId, user.id))
											.innerJoin(principal, eq(user.principalId, principal.id))
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
									yield* Effect.logDebug("auth.basic: user not found", {
										username: creds.username,
									});
									yield* Metric.increment(
										Metric.tagged(authCounter, "auth.outcome", "not_found"),
									);
									return new Unauthenticated() as AuthResult;
								}

								// InternalError from Bun.password is a defect (unexpected), not a domain error
								const valid = yield* crypto
									.verifyPassword(creds.password, row.authCredential)
									.pipe(Effect.orDie);
								if (!valid) {
									yield* Effect.logDebug("auth.basic: invalid password", {
										username: creds.username,
									});
									yield* Metric.increment(
										Metric.tagged(
											authCounter,
											"auth.outcome",
											"invalid_password",
										),
									);
									return new Unauthenticated() as AuthResult;
								}

								yield* Effect.logDebug("auth.basic: success", {
									userId: row.userId,
									username: creds.username,
								});
								yield* Metric.increment(
									Metric.tagged(authCounter, "auth.outcome", "success"),
								);
								return new Authenticated({
									principal: {
										principalId: PrincipalId(row.principalId),
										userId: UserId(row.userId),
										displayName: Option.fromNullable(row.displayName),
									},
								}) as AuthResult;
							}),
					});
				},
				Effect.tapError((e) =>
					Effect.all(
						[
							Effect.logWarning("auth.basic: error during authentication", {
								cause: e instanceof DatabaseError ? e.cause : e,
							}),
							Metric.increment(
								Metric.tagged(authCounter, "auth.outcome", "error"),
							),
						],
						{ discard: true },
					),
				),
			),
		});
	}),
);
