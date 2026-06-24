import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PgClient } from "@effect/sql-pg";
import { PgliteClient } from "@effect/sql-pglite";
import { MemoryFS, PGlite, type PGliteInterface } from "@electric-sql/pglite";
import { icuDataDir } from "@electric-sql/pglite-icu-full";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { type Context, Effect, Layer } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import { relations } from "#src/db/drizzle/relations.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(HERE, "../db/drizzle/migrations");
// PGlite's WASM declares an initial memory of 2048 pages (128 MiB); the
// imported memory must be at least that large or V8 rejects instantiation
// with a LinkError.
const INITIAL_MEMORY = 134217728; // 128 MiB
const DUMP_PATH = resolve(HERE, "test-db-cache.tar.gz");

let needGenerateDump = false;
async function makePgLiteInstance(): Promise<PGlite> {
	const memoryFs = new MemoryFS();
	const dumpData = await readFile(DUMP_PATH)
		.then((buf) => new Blob([new Uint8Array(buf)]))
		.catch(() => {
			needGenerateDump = true;
			return undefined;
		});
	const pg = new PGlite({
		fs: memoryFs,
		loadDataDir: dumpData,
		relaxedDurability: true,
		initialMemory: INITIAL_MEMORY,
		icuDataDir: await icuDataDir(),
	});

	return pg;
}

let cachedPgLiteInstance: PGlite | undefined;

// Acquire a fresh PGlite instance (cloned from a shared, already-migrated base)
// for one test. The first-ever instance runs the drizzle migrations against a
// raw (promise-based) drizzle client and dumps the migrated data dir to disk so
// subsequent clones load instantly from the cache.
async function acquireClonedInstance(): Promise<PGliteInterface> {
	if (!cachedPgLiteInstance) {
		cachedPgLiteInstance = await makePgLiteInstance();
	}
	const pg = await cachedPgLiteInstance.clone();
	if (needGenerateDump) {
		// Raw drizzle client used solely to run migrations one time.
		const migrationDb = drizzle({ client: pg as PGlite, relations });
		await migrate(
			readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }),
			migrationDb,
			{ migrationsFolder: MIGRATIONS_FOLDER },
		);
		const dump = await pg.dumpDataDir("gzip");
		await writeFile(DUMP_PATH, dump.stream());
		needGenerateDump = false;
		// Reset so the next clone comes from the dump (which has migrations),
		// not from the un-migrated instance that was cached before migration ran.
		cachedPgLiteInstance = undefined;
	}
	return pg;
}

// ---------------------------------------------------------------------------
// makePgliteDatabaseLayer — provides DatabaseClient backed by an in-memory
// PGlite database, via drizzle's native Effect integration.
//
// effect-postgres requires a `@effect/sql-pg` PgClient; we satisfy that tag
// with a PGlite-backed client from `@effect/sql-pglite` (effect-postgres only
// uses the shared SqlClient surface — `unsafe` / `withTransaction`).
// ---------------------------------------------------------------------------
export const makePgliteDatabaseLayer = (): Layer.Layer<
	DatabaseClient,
	Error
> => {
	// Layer<PgliteClient | SqlClient> over a freshly cloned, migrated instance.
	const pgliteClientLayer = Layer.unwrap(
		Effect.gen(function* () {
			const pg = yield* Effect.acquireRelease(
				// @effect-diagnostics-next-line globalErrorInEffectFailure:off
				Effect.tryPromise({
					try: () => acquireClonedInstance(),
					// @effect-diagnostics-next-line globalErrorInEffectFailure:off
					catch: (e) => new Error(`PGlite setup failed: ${String(e)}`),
				}),
				(pg) => Effect.promise(() => pg.close()),
			);
			return PgliteClient.layer({ liveClient: pg as PGliteInterface });
		}),
	);

	// Expose the PGlite-backed client under the PgClient tag that
	// effect-postgres resolves. The two clients share the SqlClient surface
	// effect-postgres uses; the cast bridges the nominal tag types.
	const pgClientLayer = Layer.effect(
		PgClient.PgClient,
		PgliteClient.PgliteClient.pipe(
			Effect.map(
				(client) =>
					client as unknown as Context.Service.Shape<typeof PgClient.PgClient>,
			),
		),
	).pipe(Layer.provide(pgliteClientLayer));

	return Layer.effect(
		DatabaseClient,
		PgDrizzle.makeWithDefaults({ relations }),
	).pipe(Layer.provide(pgClientLayer)) as Layer.Layer<DatabaseClient, Error>;
};
