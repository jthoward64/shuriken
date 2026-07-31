import { Effect, Layer } from "effect";
import { AppConfigService } from "#src/config.ts";
import { InternalError } from "#src/domain/errors.ts";
import { FileService } from "#src/platform/file.ts";
import { strongEtag } from "../asset-etag.ts";
import { uiAssetPath } from "../asset-root.ts";
import { CssService } from "./service.ts";

// ---------------------------------------------------------------------------
// CssServiceLive — loads the stylesheet compiled by `deno task ui:css`.
//
// Compilation happens ahead of time rather than at startup: the
// Tailwind/PostCSS/cssnano toolchain costs ~36 MB of heap (~74 MB RSS) and is
// only needed once, so importing it here would keep a compiler resident in the
// server process for its whole lifetime. scripts/build-css.ts runs it in a
// separate short-lived process instead. Ahead-of-time also suits the runtime's
// read-only root filesystem, which could not write compiler output anyway.
// ---------------------------------------------------------------------------

export const CssServiceLive = Layer.effect(
	CssService,
	Effect.gen(function* () {
		const files = yield* FileService;
		const config = yield* AppConfigService;
		const appCss = uiAssetPath(config, "app.css");

		const css = yield* files.readText(appCss).pipe(
			Effect.catch((cause: InternalError) =>
				Effect.fail(
					new InternalError({
						cause: new Error(
							`missing compiled stylesheet at ${appCss} — run \`deno task ui:css\``,
							{ cause },
						),
					}),
				),
			),
		);

		const etag = yield* strongEtag(css);

		yield* Effect.logInfo("loaded UI stylesheet", {
			bytes: css.length,
			etag,
		});

		return { css, etag };
	}),
);
