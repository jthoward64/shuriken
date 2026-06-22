import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { expandGlob } from "@std/fs";
import { Context, Effect, Layer } from "effect";
import { InternalError } from "#src/domain/errors.ts";

// ---------------------------------------------------------------------------
// FileService — wraps filesystem access behind an Effect interface so that
// business logic never imports platform/runtime APIs directly.
// ---------------------------------------------------------------------------

export interface FileServiceShape {
	readonly readText: (path: string) => Effect.Effect<string, InternalError>;
	readonly readBytes: (
		path: string,
	) => Effect.Effect<Uint8Array, InternalError>;
	readonly exists: (path: string) => Effect.Effect<boolean, never>;
	readonly mimeType: (path: string) => string | undefined;
	/** Enumerate files matching a glob pattern relative to cwd. */
	readonly glob: (
		pattern: string,
		cwd?: string,
	) => Effect.Effect<ReadonlyArray<string>, InternalError>;
}

export class FileService extends Context.Tag("FileService")<
	FileService,
	FileServiceShape
>() {}

// ---------------------------------------------------------------------------
// Minimal extension → MIME map for the file types this server serves
// statically (templates + static assets). Kept local so the adapter has no
// runtime-specific MIME dependency.
// ---------------------------------------------------------------------------

const MIME_BY_EXT: Readonly<Record<string, string>> = {
	css: "text/css; charset=utf-8",
	js: "text/javascript; charset=utf-8",
	mjs: "text/javascript; charset=utf-8",
	json: "application/json; charset=utf-8",
	svg: "image/svg+xml",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	ico: "image/x-icon",
	woff: "font/woff",
	woff2: "font/woff2",
	ttf: "font/ttf",
	txt: "text/plain; charset=utf-8",
	html: "text/html; charset=utf-8",
	map: "application/json; charset=utf-8",
};

const mimeForPath = (path: string): string | undefined => {
	const dot = path.lastIndexOf(".");
	if (dot < 0) {
		return undefined;
	}
	return MIME_BY_EXT[path.slice(dot + 1).toLowerCase()];
};

// ---------------------------------------------------------------------------
// Live implementation — node:fs + @std/fs (portable across Deno/Node).
// ---------------------------------------------------------------------------

export const FileServiceLive = Layer.succeed(FileService, {
	readText: (path) =>
		Effect.tryPromise({
			try: () => readFile(path, "utf8"),
			catch: (e) => new InternalError({ cause: e }),
		}),

	readBytes: (path) =>
		Effect.tryPromise({
			try: () => readFile(path).then((buf) => new Uint8Array(buf)),
			catch: (e) => new InternalError({ cause: e }),
		}),

	exists: (path) => Effect.sync(() => existsSync(path)),

	mimeType: (path) => mimeForPath(path),

	glob: (pattern, cwd) =>
		Effect.tryPromise({
			try: async () => {
				const root = cwd ?? ".";
				const out: Array<string> = [];
				for await (const entry of expandGlob(pattern, {
					root,
					includeDirs: false,
				})) {
					// Match Bun.Glob.scanSync semantics: paths relative to cwd.
					out.push(relative(root, entry.path));
				}
				return out;
			},
			catch: (e) => new InternalError({ cause: e }),
		}),
});
