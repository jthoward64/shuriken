import type { Cause } from "effect";
import { Effect, Exit, FiberRef, Option, Runtime } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { DatabaseError } from "#src/domain/errors.ts";

// ---------------------------------------------------------------------------
// TransactionRef — fiber-local active transaction client
//
// None = use the captured pool connection (default).
// Some(tx) = use this transaction client for all queries in the fiber tree.
// ---------------------------------------------------------------------------

export const TransactionRef: FiberRef.FiberRef<Option.Option<DbClient>> =
	FiberRef.unsafeMake(Option.none());

// ---------------------------------------------------------------------------
// getActiveDb — called at query time to pick up an active transaction
//
// Repositories call this instead of using the captured db directly so that
// withTransaction can transparently redirect queries to a transaction client.
// ---------------------------------------------------------------------------

export const getActiveDb = (fallback: DbClient): Effect.Effect<DbClient> =>
	FiberRef.get(TransactionRef).pipe(
		Effect.map(Option.getOrElse(() => fallback)),
	);

// ---------------------------------------------------------------------------
// EffectExitWrapper — sentinel for bridging typed failures across the async
// boundary of Drizzle's callback-based transaction API.
//
// Drizzle commits on resolve, rolls back on reject. We must throw to trigger
// rollback on Effect failure, but we need to distinguish an Effect typed
// failure (which should be re-raised as Effect.fail) from a real DB error.
// ---------------------------------------------------------------------------

class EffectExitWrapper extends Error {
	// Exit type parameters are recovered via cast at the call site; using
	// unknown here is the minimum needed to satisfy the extremely complex
	// Exit<A,E> generic while keeping the sentinel class parameter-free.
	readonly exit: Exit.Exit<unknown, unknown>;

	constructor(exit: Exit.Exit<unknown, unknown>) {
		super("EffectExitWrapper");
		this.exit = exit;
	}
}

// ---------------------------------------------------------------------------
// withTransaction — wraps an Effect in a Drizzle database transaction.
//
// - Commits on success, rolls back on typed failure or defect.
// - "Join outer": if already inside a transaction (FiberRef is Some), the
//   effect runs in the existing transaction without starting a new one.
//   This allows nested callers (e.g. provisionUser → collectionService.create)
//   to share one connection without being aware of each other.
// ---------------------------------------------------------------------------

export const withTransaction = <A, E, R>(
	effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | DatabaseError, R | DatabaseClient> =>
	Effect.gen(function* () {
		const existing = yield* FiberRef.get(TransactionRef);
		if (Option.isSome(existing)) {
			return yield* effect;
		}

		const db = yield* DatabaseClient;
		const runtime = yield* Effect.runtime<R>();

		return yield* Effect.withSpan("db.transaction")(
			Effect.async<A, E | DatabaseError>((resume) => {
				db.transaction(async (tx) => {
					const exit = await Runtime.runPromise(runtime)(
						Effect.locally(TransactionRef, Option.some(tx as DbClient))(
							Effect.exit(effect),
						),
					);
					if (Exit.isSuccess(exit)) {
						return exit.value;
					}
					throw new EffectExitWrapper(exit);
				}).then(
					(value) => resume(Effect.succeed(value as A)),
					(e) => {
						if (e instanceof EffectExitWrapper && Exit.isFailure(e.exit)) {
							resume(
								Effect.failCause(e.exit.cause as Cause.Cause<E>),
							);
						} else {
							resume(Effect.fail(new DatabaseError({ cause: e })));
						}
					},
				);
			}),
		);
	});
