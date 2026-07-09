// Docker build step: runs the same Deno.bundle() calls ClientJsServiceLive
// makes at server startup, so npm package resolution/downloads land in
// DENO_DIR during the (writable) build stage instead of at runtime, where
// readOnlyRootFilesystem leaves DENO_DIR read-only. The bundled output itself
// is discarded — the running server still bundles in-memory at startup, this
// only pre-warms its cache. Run with: `deno run -A scripts/warm-client-bundle-cache.ts`.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleClient } from "#src/http/ui/client/compile.ts";
import { ENTRIES } from "#src/http/ui/client/index.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.resolve(HERE, "../src/http/ui/client");

for (const { name, entry } of ENTRIES) {
	const entryUrl = pathToFileURL(path.resolve(CLIENT_DIR, entry));
	await bundleClient({ entry: entryUrl });
	console.log(`warmed cache for ${name}`);
}
