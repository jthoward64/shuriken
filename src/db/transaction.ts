import { Context, Effect, Option } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { DatabaseError } from "#src/domain/errors.ts";

// ---------------------------------------------------------------------------
// TransactionRef — fiber-local active transaction client (Context.Reference)
//
// None = use the captured pool connection (default).
// Some(tx) = use this transaction client for all queries in the fiber tree.
//
// Provided (scoped) by withTransaction; read by getActiveDb so repositories
// transparently route their queries to the open transaction.
// ---------------------------------------------------------------------------

export const TransactionRef: Context.Reference<Option.Option<DbClient>> =
	Context.Reference<Option.Option<DbClient>>("TransactionRef", {
		defaultValue: () => Option.none(),
	});

// ---------------------------------------------------------------------------
// getActiveDb — called at query time to pick up an active transaction
//
// Repositories call this instead of using the captured db directly so that
// withTransaction can transparently redirect queries to a transaction client.
// ---------------------------------------------------------------------------

export const getActiveDb = (fallback: DbClient): Effect.Effect<DbClient> =>
	TransactionRef.pipe(Effect.map(Option.getOrElse(() => fallback)));

// ---------------------------------------------------------------------------
// withTransaction — wraps an Effect in a Drizzle (effect-postgres) transaction.
//
// Uses the driver's native, Effect-returning `db.transaction(tx => Effect)`:
// commits on success, rolls back on failure/defect — no manual Promise/exit
// bridging required.
//
// "Join outer": if already inside a transaction (TransactionRef is Some), the
// effect runs in the existing transaction without starting a nested one. This
// allows nested callers (e.g. provisionUser → collectionService.create) to
// share one connection without being aware of each other.
// ---------------------------------------------------------------------------

export const withTransaction = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | DatabaseError, R | DatabaseClient> =>
	Effect.gen(function* () {
		const existing = yield* TransactionRef;
		if (Option.isSome(existing)) {
			return yield* effect;
		}

		const db = yield* DatabaseClient;

		return yield* Effect.withSpan("db.transaction")(
			db
				.transaction((tx) =>
					effect.pipe(
						Effect.provideService(
							TransactionRef,
							Option.some(tx as unknown as DbClient),
						),
					),
				)
				.pipe(
					// Map the driver's transaction-machinery SqlError to our DatabaseError,
					// leaving the wrapped effect's own typed failures (E) intact.
					Effect.catchTag("SqlError", (e) =>
						Effect.fail(new DatabaseError({ cause: e })),
					),
				),
		);
	});
