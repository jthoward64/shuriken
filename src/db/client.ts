import { drizzle } from "drizzle-orm/postgres-js";
import { Context, Effect, Layer, Redacted } from "effect";
import postgres from "postgres";
import { AppConfigService } from "#src/config.ts";
import { relations } from "./drizzle/relations.ts";

// ---------------------------------------------------------------------------
// DatabaseClient — Drizzle ORM client as an Effect.Service
//
// Uses postgres.js (the `postgres` package) via drizzle-orm/postgres-js. It is
// a pure-JS driver with a built-in connection pool, created once when the Layer
// is built and shared across all requests through the ManagedRuntime.
//
// drizzle-orm/postgres-js installs identity ("transparent") parsers for the
// date/time OIDs, so timestamps arrive as raw strings; our custom Temporal
// column types in schema/types.ts then go string → Temporal directly, avoiding
// a wasteful string → Date → Temporal double conversion.
//
// Pass `client` explicitly in the config object — `drizzle(client, …)` would
// make drizzle spin up its own default connection and silently ignore this
// client.
//
// `relations` (see ./drizzle/relations.ts) powers the `db.query.*` relational
// API; it carries no runtime FKs of its own, it only describes the join graph.
// ---------------------------------------------------------------------------

export class DatabaseClient extends Context.Service<DatabaseClient>()(
	"DatabaseClient",
	{
		make: Effect.gen(function* () {
			const {
				database: { url },
			} = yield* AppConfigService;
			const client = postgres(Redacted.value(url));
			const db = drizzle({ client, relations });
			yield* Effect.logInfo("database client initialized");
			return db;
		}),
	},
) {}

export const DatabaseClientLive = Layer.effect(
	DatabaseClient,
	DatabaseClient.make,
);

// The concrete Drizzle DB type, derived from the service's resolved shape so it
// always matches what `yield* DatabaseClient` produces (avoids drift between a
// hand-written type and Drizzle's inferred relations-aware database type).
export type DbClient = Context.Service.Shape<typeof DatabaseClient>;
