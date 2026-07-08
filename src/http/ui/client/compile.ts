// ---------------------------------------------------------------------------
// Client-side TypeScript bundling — the JS counterpart to css/compile.ts.
//
// Browser entry points under this directory are bundled with Deno's native
// `Deno.bundle()` (esbuild under the hood) into a single self-contained
// script at server startup, held in memory, and served from /static/*.js.
// Kept framework-agnostic (a plain async function); the Effect wrapper lives
// in service.live.ts.
//
// Deno.bundle() resolves real npm imports (including subpath exports), so
// client entries may import npm packages directly — unlike the previous
// @deno/emit-based bundler (now archived upstream), which could only resolve
// relative/local imports. Deno.bundle() is unstable as of Deno 2.9.1 —
// enabled project-wide via deno.json's `unstable: ["bundle"]` (runtime) and
// `compilerOptions.lib: [..., "deno.unstable"]` (type-checking), rather than
// a per-task CLI flag. This is the sole call site to update if its signature
// changes in a future Deno release.
// ---------------------------------------------------------------------------

export interface BundleClientOptions {
	/** File URL (or path) of the browser entry module. */
	readonly entry: string | URL;
	/** When false, skip minification (readable debug output). */
	readonly minify?: boolean;
}

export interface BundleClientResult {
	readonly js: string;
	/**
	 * Extracted CSS, present only when the entry imports a `.css` file as a
	 * side effect (e.g. `import "fullcalendar/skeleton.css"`). Deno.bundle()
	 * only splits CSS into a separate output when `outputDir` is set — it's
	 * otherwise unused since `write: false` keeps everything in memory.
	 */
	readonly css: string | undefined;
}

export const bundleClient = async ({
	entry,
	minify = true,
}: BundleClientOptions): Promise<BundleClientResult> => {
	const result = await Deno.bundle({
		entrypoints: [typeof entry === "string" ? entry : entry.href],
		outputDir: "dist",
		write: false,
		platform: "browser",
		minify,
	});
	if (!result.success) {
		throw new AggregateError(result.errors, "Deno.bundle failed");
	}
	const files = result.outputFiles ?? [];
	const js = files.find((f) => f.path.endsWith(".js"));
	const css = files.find((f) => f.path.endsWith(".css"));
	if (!js) {
		throw new Error("Deno.bundle produced no JS output");
	}
	return { js: js.text(), css: css?.text() };
};
