import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { Effect, Redacted } from "effect";
import postgres from "postgres";
import { AppConfigService } from "#src/config.ts";
import * as schema from "./drizzle/schema/index.ts";

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
// make drizzle spin up its own default connection and silently ignore both
// this client and the schema.
// ---------------------------------------------------------------------------

export type DbClient = PostgresJsDatabase<typeof schema>;

export class DatabaseClient extends Effect.Service<DatabaseClient>()(
	"DatabaseClient",
	{
		effect: Effect.gen(function* () {
			const {
				database: { url },
			} = yield* AppConfigService;
			const client = postgres(Redacted.value(url));
			const db = drizzle({ client, schema });
			yield* Effect.logInfo("database client initialized");
			return db;
		}),
	},
) {}

export const DatabaseClientLive = DatabaseClient.Default;
