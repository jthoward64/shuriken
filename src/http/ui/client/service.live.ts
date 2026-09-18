import { Effect, Layer } from "effect";
import { AppConfigService } from "#src/config.ts";
import { InternalError } from "#src/domain/errors.ts";
import { FileService } from "#src/platform/file.ts";
import { strongEtag } from "../asset-etag.ts";
import { uiAssetPath } from "../asset-root.ts";
import { type ClientAsset, ClientJsService } from "./service.ts";

const JS_EXTENSION = /\.js$/u;

// ---------------------------------------------------------------------------
// ClientJsServiceLive — loads the browser scripts compiled by
// `deno task ui:js`. Add an entry here to ship a new script; the router maps
// its `name` to a /static/<name> route.
//
// Bundling runs ahead of time rather than at startup for the same reasons as
// the stylesheet: Deno.bundle() spends ~24 MB of RSS on esbuild's native
// allocations, needs the .client.ts sources on disk (which a bundled server
// distribution has no reason to ship), and cannot write under the runtime's
// read-only root filesystem.
// ---------------------------------------------------------------------------

// Served filename → client TS entry module (relative to this directory).
// Shared with scripts/build-client-js.ts, which compiles these entries into the
// UI asset directory; this service only reads what that script produced.
export const ENTRIES: ReadonlyArray<{
	readonly name: string;
	readonly entry: string;
}> = [
	{ name: "calendar.js", entry: "calendar.client.ts" },
	{ name: "reorder.js", entry: "reorder.client.ts" },
	{ name: "embed-widget.js", entry: "embed-widget.client.ts" },
	{ name: "forms.js", entry: "forms.client.ts" },
	{ name: "date-picker.js", entry: "date-picker.client.ts" },
];

/** Served filename of the stylesheet an entry emits, if it imports one. */
export const cssNameFor = (name: string): string =>
	name.replace(JS_EXTENSION, ".css");

// Read one compiled asset off disk and record it with a strong ETag
const loadAsset = Effect.fn("ui.clientJs.loadAsset")(function* (
	assets: Map<string, ClientAsset>,
	assetPath: string,
	name: string,
) {
	const files = yield* FileService;
	const code = yield* files.readText(assetPath).pipe(
		Effect.catch((cause: InternalError) =>
			Effect.fail(
				new InternalError({
					cause: new Error(
						`missing compiled client asset at ${assetPath} - run \`deno task ui:js\``,
						{ cause },
					),
				}),
			),
		),
	);
	const etag = yield* strongEtag(code);
	assets.set(name, { code, etag });
	yield* Effect.logInfo("loaded client asset", {
		name,
		bytes: code.length,
		etag,
	});
});

export const ClientJsServiceLive = Layer.effect(
	ClientJsService,
	Effect.gen(function* () {
		const files = yield* FileService;
		const config = yield* AppConfigService;
		const assets = new Map<string, ClientAsset>();

		for (const { name } of ENTRIES) {
			yield* loadAsset(assets, uiAssetPath(config, name), name);
			// Only entries importing a stylesheet for side effect emit one, so a
			// missing .css is expected rather than a misconfigured build.
			const cssName = cssNameFor(name);
			const cssPath = uiAssetPath(config, cssName);
			if (yield* files.exists(cssPath)) {
				yield* loadAsset(assets, cssPath, cssName);
			}
		}

		return { assets };
	}),
);
