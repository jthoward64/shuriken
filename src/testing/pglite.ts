import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { MemoryFS, PGlite } from "@electric-sql/pglite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { migrate } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { Effect, Layer } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import * as schema from "#src/db/drizzle/schema/index.ts";

const MIGRATIONS_FOLDER = resolve(import.meta.dir, "../db/drizzle/migrations");
const INITIAL_MEMORY = 67108864; // 64 MiB
const DUMP_PATH = resolve(import.meta.dir, "test-db-cache.tar.gz");

let needGenerateDump = false;
async function makePgLiteInstance(): Promise<PGlite> {
	const memoryFs = new MemoryFS();
	const dumpData = await readFile(DUMP_PATH)
		.then((buf) => new Blob([buf]))
		.catch(() => {
			needGenerateDump = true;
			return undefined;
		});
	const pg = new PGlite({
		fs: memoryFs,
		loadDataDir: dumpData,
		relaxedDurability: true,
		initialMemory: INITIAL_MEMORY,
	});

	return pg;
}

let cachedPgLiteInstance: PGlite | undefined;

// @effect-diagnostics-next-line globalErrorInEffectCatch:off
export const makePgliteDatabaseLayer = (): Layer.Layer<DatabaseClient, Error> =>
	Layer.effect(
		DatabaseClient,
		Effect.tryPromise({
			try: async () => {
				if (!cachedPgLiteInstance) {
					cachedPgLiteInstance = await makePgLiteInstance();
				}
				const pg = await cachedPgLiteInstance.clone();
				const db = drizzle({ client: pg as PGlite, schema });
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
				return DatabaseClient.make(db as unknown as DatabaseClient);
			},
			// @effect-diagnostics-next-line globalErrorInEffectFailure:off
			catch: (e) => new Error(`PGlite migration failed: ${String(e)}`),
		}),
	);
