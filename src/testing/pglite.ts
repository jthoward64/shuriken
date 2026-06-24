import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryFS, PGlite } from "@electric-sql/pglite";
import { icuDataDir } from "@electric-sql/pglite-icu-full";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { Effect, Layer } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
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

// @effect-diagnostics-next-line globalErrorInEffectCatch:off
export const makePgliteDatabaseLayer = (): Layer.Layer<DatabaseClient, Error> =>
	Layer.effect(
		DatabaseClient,
		Effect.acquireRelease(
			Effect.tryPromise({
				try: async () => {
					if (!cachedPgLiteInstance) {
						cachedPgLiteInstance = await makePgLiteInstance();
					}
					const pg = await cachedPgLiteInstance.clone();
					const db = drizzle({ client: pg as PGlite, relations });
					if (needGenerateDump) {
						await migrate(
							readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }),
							db,
							{ migrationsFolder: MIGRATIONS_FOLDER },
						);
						const dump = await pg.dumpDataDir("gzip");
						await writeFile(DUMP_PATH, dump.stream());
						needGenerateDump = false;
						// Reset so the next clone comes from the dump (which has migrations),
						// not from the un-migrated instance that was cached before migration ran.
						cachedPgLiteInstance = undefined;
					}
					// PGlite is structurally compatible for all Drizzle operations we use;
					// the QueryResultHKT difference is only a compile-time type parameter.
					return {
						client: db as unknown as DbClient,
						pg,
					};
				},
				// @effect-diagnostics-next-line globalErrorInEffectFailure:off
				catch: (e) => new Error(`PGlite setup failed: ${String(e)}`),
			}),
			({ pg }) => Effect.promise(() => pg.close()),
		).pipe(Effect.map(({ client }) => client)),
	);
