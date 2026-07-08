import { eq } from "drizzle-orm";
import { Effect, Layer, Metric, Option } from "effect";
import { AuthService } from "#src/auth/service.ts";
import { AppConfigService } from "#src/config.ts";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { principal, user } from "#src/db/drizzle/schema/index.ts";
import { AuthError, DatabaseError } from "#src/domain/errors.ts";
import { PrincipalId, UserId } from "#src/domain/ids.ts";
import type { AuthenticatedPrincipal } from "#src/domain/types/dav.ts";
import { Authenticated } from "#src/domain/types/dav.ts";
import { Email } from "#src/domain/types/strings.ts";
import { authAttemptsTotal } from "#src/observability/metrics.ts";

// ---------------------------------------------------------------------------
// Single-user auth layer
//
// All requests are treated as a single authenticated user — no credentials
// are checked. Useful for development and self-hosted single-user setups.
//
// The principal is resolved per-request so that:
//   - Layer build is infallible (no DB call at startup)
//   - Changes to the user row are reflected without restarting the server
// ---------------------------------------------------------------------------

const authCounter = Metric.withAttributes(authAttemptsTotal, {
	"auth.mode": "single-user",
});

/**
 * Resolve a principal for auto-login / single-user mode. Looks up the user by
 * email (if provided), falling back to the first user in the database when the
 * configured email is not found or no email is configured. Fails with AuthError
 * when no users exist.
 *
 * Shared between SingleUserAuthLayer and CompositeAuthLayer.
 */
export const resolveAutoLoginPrincipal = (
	db: DbClient,
	email: Option.Option<Email>,
): Effect.Effect<AuthenticatedPrincipal, AuthError | DatabaseError> =>
	Effect.gen(function* () {
		yield* Effect.logTrace("auth.single-user: resolving principal", {
			email: Option.getOrUndefined(email),
		});
		const rows = yield* db
			.select({
				userId: user.id,
				principalId: user.principalId,
				displayName: principal.displayName,
			})
			.from(user)
			.innerJoin(principal, eq(user.principalId, principal.id))
			.where(Option.getOrUndefined(Option.map(email, (e) => eq(user.email, e))))
			.limit(1)
			.pipe(Effect.mapError((e) => new DatabaseError({ cause: e })));

		const row = rows[0];
		if (row) {
			yield* Effect.logTrace("auth.single-user: principal resolved", {
				userId: row.userId,
			});
			return {
				principalId: PrincipalId(row.principalId),
				userId: UserId(row.userId),
				displayName: Option.fromNullishOr(row.displayName),
			};
		}

		// If a specific email was configured but not found (e.g. the user changed
		// their email), fall back to the first user rather than locking everyone out.
		if (Option.isSome(email)) {
			yield* Effect.logWarning(
				"auth.single-user: AUTO_LOGIN email not found, falling back to first user",
				{ configuredEmail: Option.getOrUndefined(email) },
			);
			return yield* resolveAutoLoginPrincipal(db, Option.none());
		}

		return yield* new AuthError({
			reason: "No users found in database for single-user mode",
		});
	});

export const SingleUserAuthLayer = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		const {
			auth: { autoLogin },
		} = yield* AppConfigService;
		const email = Option.map(autoLogin, Email);

		return {
			// Resolve per-request: layer build is infallible, user row changes
			// are reflected immediately without restarting the server.
			authenticate: Effect.fn("auth.single-user.authenticate")(
				function* (_headers, _clientIp) {
					yield* Effect.annotateCurrentSpan({ "auth.mode": "single-user" });
					yield* Effect.logTrace("auth.single-user: authenticating");
					const resolved = yield* resolveAutoLoginPrincipal(db, email);
					yield* Metric.update(
						Metric.withAttributes(authCounter, { "auth.outcome": "success" }),
						1,
					);
					return new Authenticated({ principal: resolved });
				},
				Effect.tapError((e) =>
					Effect.all(
						[
							e instanceof AuthError
								? Effect.logWarning("auth.single-user: principal not found", {
										reason: e.reason,
									})
								: Effect.logWarning(
										"auth.single-user: error during authentication",
										{ cause: e instanceof DatabaseError ? e.cause : e },
									),
							Metric.update(
								Metric.withAttributes(authCounter, { "auth.outcome": "error" }),
								1,
							),
						],
						{ discard: true },
					),
				),
			),
		};
	}),
);
