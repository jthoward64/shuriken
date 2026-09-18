// Build step: bundles the browser entry points into the UI asset directory.
// ClientJsService serves these files verbatim at runtime, so they must be
// regenerated whenever a *.client.ts entry or its imports change. Running
// Deno.bundle() here rather than at server startup keeps esbuild's ~24 MB of
// native allocations out of the long-lived server process, and avoids needing
// the client sources (or a writable filesystem) at runtime. Run with:
// `deno task ui:js` — the Docker build and the `dev` task both do.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { bundleClient } from "#src/http/ui/client/compile.ts";
import { cssNameFor, ENTRIES } from "#src/http/ui/client/index.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const CLIENT_DIR = path.join(ROOT, "src/http/ui/client");
const OUT_DIR = path.join(ROOT, "src/http/ui/static");

await Deno.mkdir(OUT_DIR, { recursive: true });

for (const { name, entry } of ENTRIES) {
	const entryUrl = pathToFileURL(path.resolve(CLIENT_DIR, entry));
	const { js, css } = await bundleClient({ entry: entryUrl });

	const jsOut = path.join(OUT_DIR, name);
	await Deno.writeTextFile(jsOut, js);
	console.log(`wrote ${jsOut} (${js.length} bytes)`);

	// Entries that import a stylesheet for side effect emit one alongside the
	// script; the rest leave any stale copy from a previous build behind, so
	// remove it rather than let ClientJsService pick it up.
	const cssOut = path.join(OUT_DIR, cssNameFor(name));
	if (css === undefined) {
		await Deno.remove(cssOut).catch(() => {
			/* nothing to clean up */
		});
		continue;
	}
	await Deno.writeTextFile(cssOut, css);
	console.log(`wrote ${cssOut} (${css.length} bytes)`);
}
