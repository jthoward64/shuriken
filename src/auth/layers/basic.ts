import { and, eq, isNull, or } from "drizzle-orm";
import { Effect, Layer, Metric, Option, Redacted } from "effect";
import { Temporal } from "temporal-polyfill";
import { AuthService } from "#src/auth/service.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { authUser, principal, user } from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import { PrincipalId, UserId, type UuidString } from "#src/domain/ids.ts";
import {
	Authenticated,
	type AuthResult,
	Unauthenticated,
} from "#src/domain/types/dav.ts";
import { authAttemptsTotal } from "#src/observability/metrics.ts";
import { CryptoService } from "#src/platform/crypto.ts";

// ---------------------------------------------------------------------------
// Basic auth
//
// Parses HTTP Basic Authentication credentials and verifies them against the
// auth_user table. Two credential kinds are accepted:
//   * authSource = "local"        — the username matches auth_id directly.
//   * authSource = "app_password" — a per-device secret; the supplied username
//     may be either the credential's generated username (auth_id) or the
//     owner's principal slug, so an OIDC user (who has no local password) can
//     still connect DAV clients.
//
// The password is verified (argon2id) against each matching candidate; the
// first match wins and its last_used_at is stamped.
// ---------------------------------------------------------------------------

const BASIC_PREFIX = "Basic ";

const authCounter = Metric.withAttributes(authAttemptsTotal, {
	"auth.mode": "basic",
});

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

	const username = decoded.slice(0, colonIdx);
	const password = decoded.slice(colonIdx + 1);

	if (password.length === 0) {
		return Option.none();
	}

	return Option.some({
		username,
		password: Redacted.make(password),
	});
};

interface Candidate {
	readonly authUserId: UuidString;
	readonly authSource: string;
	readonly authCredential: Redacted.Redacted<string> | null;
	readonly userId: UuidString;
	readonly principalId: UuidString;
	readonly displayName: string | null;
}

/**
 * Core basic-auth logic. Parses the Authorization header, looks up matching
 * local / app-password credentials, verifies the password, and emits
 * per-outcome metrics. Returns Unauthenticated when no credentials are present,
 * no candidate matches, or every password check fails.
 *
 * Shared between BasicAuthLayer and CompositeAuthLayer.
 */
export const authenticateBasic = (
	headers: Headers,
): Effect.Effect<AuthResult, DatabaseError, DatabaseClient | CryptoService> =>
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		const crypto = yield* CryptoService;

		return yield* Option.match(parseBasicAuth(headers), {
			onNone: () =>
				Effect.gen(function* () {
					yield* Effect.logTrace("auth.basic: no credentials present");
					yield* Metric.update(
						Metric.withAttributes(authCounter, {
							"auth.outcome": "no_credentials",
						}),
						1,
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

					const candidates: ReadonlyArray<Candidate> = yield* db
						.select({
							authUserId: authUser.id,
							authSource: authUser.authSource,
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
								isNull(principal.deletedAt),
								or(
									and(
										eq(authUser.authSource, "local"),
										eq(authUser.authId, creds.username),
									),
									and(
										eq(authUser.authSource, "app_password"),
										or(
											eq(authUser.authId, creds.username),
											eq(principal.slug, creds.username),
										),
									),
								),
							),
						)
						.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));

					if (candidates.length === 0) {
						yield* Effect.logDebug("auth.basic: user not found", {
							username: creds.username,
						});
						yield* Metric.update(
							Metric.withAttributes(authCounter, {
								"auth.outcome": "not_found",
							}),
							1,
						);
						return new Unauthenticated() as AuthResult;
					}

					for (const candidate of candidates) {
						if (candidate.authCredential === null) {
							continue;
						}
						// InternalError from the crypto service is a defect, not a domain error.
						const valid = yield* crypto
							.verifyPassword(creds.password, candidate.authCredential)
							.pipe(Effect.orDie);
						if (!valid) {
							continue;
						}

						if (candidate.authSource === "app_password") {
							yield* db
								.update(authUser)
								.set({ lastUsedAt: Temporal.Now.instant() })
								.where(eq(authUser.id, candidate.authUserId))
								.pipe(
									Effect.mapError((e) => new DatabaseError({ cause: e })),
									// A failed last_used_at stamp must not fail the auth.
									Effect.ignore,
								);
						}

						yield* Effect.logDebug("auth.basic: success", {
							userId: candidate.userId,
							username: creds.username,
							authSource: candidate.authSource,
						});
						yield* Metric.update(
							Metric.withAttributes(authCounter, {
								"auth.outcome": "success",
							}),
							1,
						);
						return new Authenticated({
							principal: {
								principalId: PrincipalId(candidate.principalId),
								userId: UserId(candidate.userId),
								displayName: Option.fromNullishOr(candidate.displayName),
							},
						}) as AuthResult;
					}

					yield* Effect.logDebug("auth.basic: invalid password", {
						username: creds.username,
					});
					yield* Metric.update(
						Metric.withAttributes(authCounter, {
							"auth.outcome": "invalid_password",
						}),
						1,
					);
					return new Unauthenticated() as AuthResult;
				}),
		});
	}).pipe(
		Effect.tapError((e) =>
			Effect.all(
				[
					Effect.logWarning("auth.basic: error during authentication", {
						cause: e instanceof DatabaseError ? e.cause : e,
					}),
					Metric.update(
						Metric.withAttributes(authCounter, { "auth.outcome": "error" }),
						1,
					),
				],
				{ discard: true },
			),
		),
	);

export const BasicAuthLayer = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		const crypto = yield* CryptoService;
		return {
			authenticate: Effect.fn("auth.basic.authenticate")(
				function* (headers, _clientIp) {
					yield* Effect.annotateCurrentSpan({ "auth.mode": "basic" });
					return yield* authenticateBasic(headers).pipe(
						Effect.provideService(DatabaseClient, db),
						Effect.provideService(CryptoService, crypto),
					);
				},
			),
		};
	}),
);
