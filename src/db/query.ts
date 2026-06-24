import { Effect } from "effect";
import { DatabaseError } from "#src/domain/errors.ts";
import { DatabaseClient, type DbClient } from "./client.ts";
import { getActiveDb } from "./transaction.ts";

// ---------------------------------------------------------------------------
// DrizzleBuilder — structural interface satisfied by every drizzle effect query
// builder (select, insert, update, delete). With drizzle's native Effect
// integration each builder IS an Effect (yield it to execute) and also exposes
// `.toSQL()` for span-attribute population.
// ---------------------------------------------------------------------------

interface DrizzleBuilder<A> extends Effect.Effect<A, unknown, never> {
	toSQL(): { sql: string; params: Array<unknown> };
}

// ---------------------------------------------------------------------------
// runDbQuery — the single entry-point for executing a drizzle query.
//
// - Resolves the active DB client (respecting any open transaction).
// - Captures the SQL via `.toSQL()` before execution and attaches it as a
//   span attribute so the query is visible in tracing tools.
// - Executes the builder Effect directly (no Promise bridge) and maps the
//   driver error to DatabaseError.
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
					builder.pipe(Effect.mapError((e) => new DatabaseError({ cause: e }))),
				),
			),
		);
	});
