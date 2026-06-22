// ---------------------------------------------------------------------------
// db-reset — wipe the application database back to an empty state.
//
// Why this exists: drizzle-kit records applied migrations in its own
// `drizzle` schema. Dropping just `public` (the obvious thing to do during
// dev) leaves that journal intact, so the next `deno task migrations:run`
// happily reports "all migrations applied" without creating any tables, and
// the server then crashes on the first query against a non-existent
// `principal`/`dav_collection`/etc. table.
//
// This script drops BOTH schemas, recreates `public`, and is invoked as
// `deno task db:reset`. Pair with `deno task migrations:run` for a fresh DB.
// ---------------------------------------------------------------------------

import pg from "pg";

const url = Deno.env.get("DATABASE_URL");
if (!url) {
	console.error("db:reset: DATABASE_URL is not set");
	Deno.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
	// Both drops are idempotent (`if exists`). The order doesn't matter — we
	// recreate `public` last so it's there for the migration runner.
	await client.query("drop schema if exists drizzle cascade");
	await client.query("drop schema if exists public cascade");
	await client.query("create schema public");
	console.log("db:reset: dropped drizzle + public schemas, recreated public");
} catch (err) {
	console.error("db:reset failed:", err);
	await client.end().catch(() => undefined);
	Deno.exit(1);
}

await client.end().catch(() => undefined);
