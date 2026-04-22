import { Context, Effect, Layer } from "effect";
import { InternalError } from "#src/domain/errors.ts";

// ---------------------------------------------------------------------------
// BunFileService — wraps Bun.file behind an Effect interface so that
// business logic never imports Bun APIs directly.
// ---------------------------------------------------------------------------

export interface BunFileServiceShape {
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

export class BunFileService extends Context.Tag("BunFileService")<
	BunFileService,
	BunFileServiceShape
>() {}

// ---------------------------------------------------------------------------
// Live implementation — wraps Bun.file
// ---------------------------------------------------------------------------

export const BunFileServiceLive = Layer.succeed(BunFileService, {
	readText: (path) =>
		Effect.tryPromise({
			try: () => Bun.file(path).text(),
			catch: (e) => new InternalError({ cause: e }),
		}),

	readBytes: (path) =>
		Effect.tryPromise({
			try: () => Bun.file(path).bytes(),
			catch: (e) => new InternalError({ cause: e }),
		}),

	exists: (path) => Effect.promise(() => Bun.file(path).exists()),

	mimeType: (path) => Bun.file(path).type || undefined,

	glob: (pattern, cwd) =>
		Effect.try({
			try: () => {
				const g = new Bun.Glob(pattern);
				return Array.from(g.scanSync({ cwd, onlyFiles: true }));
			},
			catch: (e) => new InternalError({ cause: e }),
		}),
});
