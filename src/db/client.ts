import { type BunSQLDatabase, drizzle } from "drizzle-orm/bun-sql";
import { Config, Effect, Layer } from "effect";
import * as schema from "./drizzle/schema/index.ts";

// ---------------------------------------------------------------------------
// DatabaseClient — Drizzle ORM client as an Effect.Service
//
// Uses Bun's native SQL driver (bun:sql) via drizzle-orm/bun-sql.
// The connection is created once when the Layer is built and shared
// across all requests through the ManagedRuntime.
// ---------------------------------------------------------------------------

export type DbClient = BunSQLDatabase<typeof schema>;

export class DatabaseClient extends Effect.Service<DatabaseClient>()(
	"DatabaseClient",
	{
		accessors: true,
		effect: Effect.gen(function* () {
			const url = yield* Config.string("DATABASE_URL");
			return drizzle(url, { schema });
		}),
	},
) {}

export const DatabaseClientLive = DatabaseClient.Default;
