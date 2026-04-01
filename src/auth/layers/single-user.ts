import { eq } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { AuthService } from "#src/auth/service.ts";
import { AppConfigService } from "#src/config.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { user } from "#src/db/drizzle/schema/index.ts";
import { AuthError, DatabaseError } from "#src/domain/errors.ts";
import { PrincipalId, UserId } from "#src/domain/ids.ts";
import { Authenticated } from "#src/domain/types/dav.ts";
import type { AuthenticatedPrincipal } from "#src/domain/types/dav.ts";
import { Email } from "#src/domain/types/strings.ts";

// ---------------------------------------------------------------------------
// Single-user auth layer
//
// All requests are treated as a single authenticated user — no credentials
// are checked. Useful for development and self-hosted single-user setups.
//
// The principal is resolved once at layer-build time and cached.
// ---------------------------------------------------------------------------

const resolvePrincipal = (
	db: DatabaseClient,
	email: Option.Option<Email>,
): Effect.Effect<AuthenticatedPrincipal, AuthError | DatabaseError> =>
	Effect.gen(function* () {
		const rows = yield* Effect.tryPromise({
			try: () =>
				db
					.select({
						userId: user.id,
						principalId: user.principalId,
						name: user.name,
					})
					.from(user)
					.where(
						Option.getOrUndefined(Option.map(email, (e) => eq(user.email, e))),
					)
					.limit(1),
			catch: (e) => new DatabaseError({ cause: e }),
		});

		const row = rows[0];
		if (row) {
			return {
				principalId: PrincipalId(row.principalId),
				userId: UserId(row.userId),
				displayName: row.name,
			};
		}

		return yield* new AuthError({
			reason: Option.match(email, {
				onSome: (e) => `Single-user principal not found for email: ${e}`,
				onNone: () => "No users found in database for single-user mode",
			}),
		});
	});

export const SingleUserAuthLayer = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		const { auth: { singleUserEmail: emailOpt } } = yield* AppConfigService;
		const email = Option.map(emailOpt, Email);

		// Resolve principal at layer-build time — cached for all requests
		const principal = yield* resolvePrincipal(db, email);

		return AuthService.of({
			authenticate: (_headers, _clientIp) =>
				Effect.succeed(new Authenticated({ principal })),
		});
	}),
);
