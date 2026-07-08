import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Layer } from "effect";
import { InternalError } from "#src/domain/errors.ts";
import { FileService } from "#src/platform/file.ts";
import { strongEtag } from "../asset-etag.ts";
import { compileCss } from "./compile.ts";
import { CssService } from "./service.ts";

// ---------------------------------------------------------------------------
// Paths — resolved relative to this file at build time.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const INPUT_CSS = path.resolve(HERE, "../styles/input.css");
// src/http/ui — scanned for used classes in both .hbs and .tsx.
const UI_DIR = path.resolve(HERE, "..");

// ---------------------------------------------------------------------------
// CssServiceLive — compiles Tailwind at startup and caches the result.
// ---------------------------------------------------------------------------

export const CssServiceLive = Layer.effect(
	CssService,
	Effect.gen(function* () {
		const files = yield* FileService;
		const input = yield* files.readText(INPUT_CSS);

		const css = yield* Effect.tryPromise({
			try: () => compileCss({ input, uiDir: UI_DIR }),
			catch: (cause) => new InternalError({ cause }),
		});

		const etag = yield* strongEtag(css);

		yield* Effect.logInfo("compiled UI stylesheet", {
			bytes: css.length,
			etag,
		});

		return { css, etag };
	}),
);
