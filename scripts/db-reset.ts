// ---------------------------------------------------------------------------
// db-reset — wipe the application database back to an empty state.
//
// Why this exists: drizzle-kit records applied migrations in its own
// `drizzle` schema. Dropping just `public` (the obvious thing to do during
// dev) leaves that journal intact, so the next `bun run migrations:run`
// happily reports "all migrations applied" without creating any tables, and
// the server then crashes on the first query against a non-existent
// `principal`/`dav_collection`/etc. table.
//
// This script drops BOTH schemas, recreates `public`, and is invoked as
// `bun run db:reset`. Pair with `bun run migrations:run` to get a fresh DB.
// ---------------------------------------------------------------------------

import { SQL } from "bun";

const url = Bun.env.DATABASE_URL;
if (!url) {
	console.error("db:reset: DATABASE_URL is not set");
	process.exit(1);
}

const sql = new SQL(url);

try {
	// Both drops are idempotent (`if exists`). The order doesn't matter — we
	// recreate `public` last so it's there for the migration runner.
	await sql`drop schema if exists drizzle cascade`;
	await sql`drop schema if exists public cascade`;
	await sql`create schema public`;
	console.log("db:reset: dropped drizzle + public schemas, recreated public");
} catch (err) {
	console.error("db:reset failed:", err);
	process.exit(1);
}

// Closing the SQL handle can raise ERR_POSTGRES_CONNECTION_CLOSED in some
// Bun/postgres combinations; swallow it because the schema operations above
// have already committed by the time we get here.
await sql.close().catch(() => undefined);
