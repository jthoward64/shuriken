import { PgClient } from "@effect/sql-pg";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { Context, Effect, Layer } from "effect";
import { AppConfigService } from "#src/config.ts";
import { relations } from "./drizzle/relations.ts";

// ---------------------------------------------------------------------------
// DatabaseClient — Drizzle ORM client as an Effect service, backed by drizzle's
// native Effect integration (`drizzle-orm/effect-postgres`) over `@effect/sql-pg`.
//
// Query builders returned by this `db` are themselves `Effect`s (yield them
// directly — see runDbQuery), so there is no Promise bridging. The underlying
// PgClient owns a postgres.js connection pool built once when the layer is
// constructed and shared across all requests through the ManagedRuntime.
//
// `relations` (see ./drizzle/relations.ts) powers the `db.query.*` relational
// API; it carries no runtime FKs of its own, it only describes the join graph.
//
// Result decoding goes through effect-postgres's codecs into our custom Temporal
// column types (schema/types.ts), whose fromDriver handles both string and Date
// driver values.
// ---------------------------------------------------------------------------

// PgClient (postgres.js pool) built from the configured, Redacted database URL.
const PgClientLive = Layer.unwrap(
	Effect.gen(function* () {
		const {
			database: { url },
		} = yield* AppConfigService;
		return PgClient.layer({ url });
	}),
);

export class DatabaseClient extends Context.Service<DatabaseClient>()(
	"DatabaseClient",
	{
		// makeWithDefaults provides no-op EffectLogger/EffectCache; only PgClient
		// remains as a requirement, satisfied by PgClientLive below.
		make: PgDrizzle.makeWithDefaults({ relations }),
	},
) {}

export const DatabaseClientLive = Layer.effect(
	DatabaseClient,
	DatabaseClient.make,
).pipe(Layer.provide(PgClientLive));

// The concrete Drizzle DB type, derived from the service's resolved shape so it
// always matches what `yield* DatabaseClient` produces (avoids drift between a
// hand-written type and Drizzle's inferred relations-aware database type).
export type DbClient = Context.Service.Shape<typeof DatabaseClient>;
