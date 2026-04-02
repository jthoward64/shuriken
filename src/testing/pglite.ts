import * as fs from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Effect, Layer } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import * as schema from "#src/db/drizzle/schema/index.ts";

// ---------------------------------------------------------------------------
// PGlite database layer for integration tests
//
// Creates a fresh in-process PostgreSQL 17 WASM instance, applies all Drizzle
// migrations with PGlite compatibility patches, and returns a DatabaseClient
// Layer. Each call produces an independent in-memory database.
//
// Patches applied before execution:
//   1. uuidv7() stub — built in to PG18+ but absent from PGlite 0.4.x (PG17).
//   2. ICU casefold(x COLLATE "und-x-icu") → lower(x) — PGlite has no ICU.
//   3. Duplicate UNIQUE constraints on identical columns → drop the second.
//      PGlite rejects two constraints covering the same column set.
//
// Type note: PgliteDatabase<typeof schema> and BunSQLDatabase<typeof schema>
// both extend the same PgDatabase query interface. The cast to DatabaseClient
// is safe at runtime; the difference is only in the driver wrapper type.
// ---------------------------------------------------------------------------

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../db/drizzle/migrations");

// ---------------------------------------------------------------------------
// uuidv7() stub (PGlite / PostgreSQL 17)
// ---------------------------------------------------------------------------
const UUIDV7_STUB_SQL = `
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
DECLARE
  ms bigint;
  ts_hex text;
  rand_a text;
  rand_b text;
  rand_c text;
BEGIN
  ms      := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  ts_hex  := lpad(to_hex(ms), 12, '0');
  rand_a  := lpad(to_hex((random() * 4095)::bigint), 3, '0');
  rand_b  := lpad(to_hex(((random() * 1023)::bigint | 2048)), 4, '0');
  rand_c  := lpad(to_hex((random() * 281474976710655)::bigint), 12, '0');
  RETURN (
    substring(ts_hex, 1, 8) || '-' ||
    substring(ts_hex, 9, 4) || '-' ||
    '7' || rand_a || '-' ||
    rand_b || '-' ||
    rand_c
  )::uuid;
END;
$$ LANGUAGE plpgsql;
`;

// ---------------------------------------------------------------------------
// patchSqlForPglite
// ---------------------------------------------------------------------------
function patchIcuCasefold(sql: string): string {
	return sql.replace(/casefold\(([^)]+) COLLATE "und-x-icu"\)/g, "lower($1)");
}

function patchDropConstraint(sql: string): string {
	// Add IF EXISTS so PGlite tolerates DROP CONSTRAINT on names that were
	// never created (e.g. when the _unique duplicate was omitted)
	return sql.replace(/DROP CONSTRAINT "([^"]+)"/g, 'DROP CONSTRAINT IF EXISTS "$1"');
}

function patchSqlForPglite(sql: string): string {
	return patchDropConstraint(patchIcuCasefold(sql));
}

// ---------------------------------------------------------------------------
// runMigrations — executes all migration SQL against PGlite directly.
// Does not use drizzle's migrate() because each PGlite instance is fresh
// and needs no tracking table.
// ---------------------------------------------------------------------------
async function runMigrations(pg: PGlite): Promise<void> {
	// Install uuidv7() before any migration references it
	await pg.exec(UUIDV7_STUB_SQL);

	const entries = fs
		.readdirSync(MIGRATIONS_FOLDER)
		.sort()
		.map((name) => ({
			name,
			sqlPath: resolve(MIGRATIONS_FOLDER, name, "migration.sql"),
		}))
		.filter(({ sqlPath }) => fs.existsSync(sqlPath));

	for (const { sqlPath } of entries) {
		const raw = fs.readFileSync(sqlPath, "utf8");
		const statements = raw.split("--> statement-breakpoint");
		for (const stmt of statements) {
			const patched = patchSqlForPglite(stmt).trim();
			if (patched) {
				await pg.exec(patched);
			}
		}
	}
}

// @effect-diagnostics-next-line globalErrorInEffectCatch:off
export const makePgliteDatabaseLayer = (): Layer.Layer<DatabaseClient, Error> =>
	Layer.effect(
		DatabaseClient,
		Effect.tryPromise({
			try: async () => {
				const pg = new PGlite();
				await runMigrations(pg);
				const db = drizzle({ client: pg, schema });
				// PgliteDatabase and BunSQLDatabase share the same PgDatabase query
				// interface; the cast is safe at runtime.
				return db as unknown as DatabaseClient;
			},
			// @effect-diagnostics-next-line globalErrorInEffectFailure:off
			catch: (e) => new Error(`PGlite migration failed: ${String(e)}`),
		}),
	);
