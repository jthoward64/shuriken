import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Effect, Redacted } from "effect";
import pg from "pg";
import { AppConfigService } from "#src/config.ts";
import * as schema from "./drizzle/schema/index.ts";

// ---------------------------------------------------------------------------
// DatabaseClient — Drizzle ORM client as an Effect.Service
//
// Uses node-postgres (pg). pg-native (libpq) is preferred when available and
// falls back to the pure-JS client otherwise. The connection pool is created
// once when the Layer is built and shared across all requests through the
// ManagedRuntime.
//
// Date/time OIDs are parsed as raw strings (identity parsers) rather than the
// pg default of JS `Date`. Our custom Temporal column types in schema/types.ts
// then go string → Temporal directly, avoiding a wasteful string → Date →
// Temporal double conversion.
// ---------------------------------------------------------------------------

const PG_OID_DATE = 1082;
const PG_OID_TIMESTAMP = 1114;
const PG_OID_TIMESTAMPTZ = 1184;

const identity = (value: string): string => value;
pg.types.setTypeParser(PG_OID_DATE, identity);
pg.types.setTypeParser(PG_OID_TIMESTAMP, identity);
pg.types.setTypeParser(PG_OID_TIMESTAMPTZ, identity);

export type DbClient = NodePgDatabase<typeof schema>;

// Prefer the native (libpq) pool; fall back to pure JS if pg-native is not
// installed/loadable (accessing pg.native triggers a require of pg-native).
const makePool = (
	connectionString: string,
): { readonly pool: pg.Pool; readonly native: boolean } => {
	try {
		const NativePool = pg.native?.Pool;
		if (NativePool) {
			return { pool: new NativePool({ connectionString }), native: true };
		}
	} catch {
		// pg-native unavailable — fall through to the JS client.
	}
	return { pool: new pg.Pool({ connectionString }), native: false };
};

export class DatabaseClient extends Effect.Service<DatabaseClient>()(
	"DatabaseClient",
	{
		effect: Effect.gen(function* () {
			const {
				database: { url },
			} = yield* AppConfigService;
			const { pool, native } = makePool(Redacted.value(url));
			// drizzle-orm v1 takes a config object; `client` must be passed
			// explicitly — `drizzle(pool, …)` would make drizzle spin up its own
			// default-config pool and silently ignore both this pool and schema.
			const db = drizzle({ client: pool, schema });
			yield* Effect.logInfo("database client initialized", {
				driver: native ? "pg-native" : "pg-js",
			});
			return db;
		}),
	},
) {}

export const DatabaseClientLive = DatabaseClient.Default;
