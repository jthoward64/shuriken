import { dirname, fromFileUrl, join, resolve } from "@std/path";
import { Option } from "effect";
import type { AppConfigType } from "#src/config.ts";

// ---------------------------------------------------------------------------
// Locates the directory holding the UI's on-disk assets (the compiled
// stylesheet, the precompiled browser scripts, and the hand-written static
// files served from src/http/ui/static).
//
// Running from source, this module sits in src/http/ui, so the assets are a
// single hop away. That breaks under a single-file bundle, where
// `import.meta.url` resolves to the bundle rather than to this file, so
// UI_ASSET_ROOT overrides the derived path. Resolving through config keeps the
// override in one place instead of at each asset call site.
// ---------------------------------------------------------------------------

const DERIVED_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "static");

/** Absolute path to the UI static asset directory. */
export const uiAssetRoot = (config: AppConfigType): string =>
	Option.match(config.ui.assetRoot, {
		onSome: (root) => resolve(root),
		onNone: () => DERIVED_ROOT,
	});

/** Absolute path to `name` within the UI static asset directory. */
export const uiAssetPath = (config: AppConfigType, name: string): string =>
	join(uiAssetRoot(config), name);
