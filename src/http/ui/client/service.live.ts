import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Effect, Layer } from "effect";
import { InternalError } from "#src/domain/errors.ts";
import { strongEtag } from "../asset-etag.ts";
import { bundleClient } from "./compile.ts";
import { type ClientAsset, ClientJsService } from "./service.ts";

// ---------------------------------------------------------------------------
// ClientJsServiceLive — bundles the browser entry points at startup and caches
// the results. Add an entry here to ship a new bundled script; the router maps
// its `name` to a /static/<name> route.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Served filename → client TS entry module (relative to this directory).
// Exported so the Docker build stage can warm DENO_DIR's npm resolution
// cache for these entries before the runtime filesystem goes read-only —
// see scripts/warm-client-bundle-cache.ts.
export const ENTRIES: ReadonlyArray<{
	readonly name: string;
	readonly entry: string;
}> = [
	{ name: "calendar.js", entry: "calendar.client.ts" },
	{ name: "reorder.js", entry: "reorder.client.ts" },
	{ name: "embed-widget.js", entry: "embed-widget.client.ts" },
];

export const ClientJsServiceLive = Layer.effect(
	ClientJsService,
	Effect.gen(function* () {
		const assets = new Map<string, ClientAsset>();
		for (const { name, entry } of ENTRIES) {
			const entryUrl = pathToFileURL(path.resolve(HERE, entry));
			const { js, css } = yield* Effect.tryPromise({
				try: () => bundleClient({ entry: entryUrl as URL }),
				catch: (cause) => new InternalError({ cause }),
			});
			const jsEtag = yield* strongEtag(js);
			assets.set(name, { code: js, etag: jsEtag });
			yield* Effect.logInfo("bundled client script", {
				name,
				bytes: js.length,
				etag: jsEtag,
			});
			if (css !== undefined) {
				const cssName = name.replace(/\.js$/, ".css");
				const cssEtag = yield* strongEtag(css);
				assets.set(cssName, { code: css, etag: cssEtag });
				yield* Effect.logInfo("bundled client stylesheet", {
					name: cssName,
					bytes: css.length,
					etag: cssEtag,
				});
			}
		}
		return { assets };
	}),
);
