import { drizzle } from "drizzle-orm/bun-sql";
import type { BunSQLDatabase } from "drizzle-orm/bun-sql/postgres/driver";
import { Effect, Redacted } from "effect";
import { AppConfigService } from "#src/config.ts";
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
		effect: Effect.gen(function* () {
			const {
				database: { url },
			} = yield* AppConfigService;
			return drizzle(Redacted.value(url), { schema });
		}),
	},
) {}

export const DatabaseClientLive = DatabaseClient.Default;
