import { Effect } from "effect";
import { DatabaseClient, type DbClient } from "./client.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import { getActiveDb } from "./transaction.ts";

// ---------------------------------------------------------------------------
// DrizzleBuilder — structural interface satisfied by every drizzle query
// builder (select, insert, update, delete). Captures `.toSQL()` for span
// attribute population and `PromiseLike` for execution.
// ---------------------------------------------------------------------------

interface DrizzleBuilder<A> extends PromiseLike<A> {
	toSQL(): { sql: string; params: Array<unknown> };
}

// ---------------------------------------------------------------------------
// runDbQuery — the single entry-point for executing a drizzle query.
//
// - Resolves the active DB client (respecting any open transaction).
// - Captures the SQL via `.toSQL()` before execution and attaches it as a
//   span attribute so the query is visible in tracing tools.
// - Wraps errors as DatabaseError.
// - Logs the SQL and params at debug level (params are kept out of span
//   attributes to avoid bloating traces with potentially large/sensitive data).
//
// Usage: return yield* runDbQuery((db) => db.select().from(table).where(...))
// ---------------------------------------------------------------------------

export const runDbQuery = <A>(
	f: (db: DbClient) => DrizzleBuilder<A>,
): Effect.Effect<A, DatabaseError, DatabaseClient> =>
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		const activeDb = yield* getActiveDb(db);
		const builder = f(activeDb);
		const { sql, params } = builder.toSQL();
		const op = sql.trim().split(/\s+/)[0]?.toLowerCase() ?? "query";
		return yield* Effect.withSpan(`db.${op}`, {
			attributes: { "db.statement": sql, "db.system": "postgresql" },
		})(
			Effect.logDebug("db.query", { sql, params }).pipe(
				Effect.andThen(
					Effect.tryPromise({
						try: () => Promise.resolve(builder),
						catch: (e) => new DatabaseError({ cause: e }),
					}),
				),
			),
		);
	});
