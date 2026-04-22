import path from "node:path";
import { Effect } from "effect";
import type { InternalError } from "#src/domain/errors.ts";
import { BunFileService } from "#src/platform/file.ts";

// ---------------------------------------------------------------------------
// Static asset handler — serves files from src/http/ui/static/
// ---------------------------------------------------------------------------

const STATIC_DIR = path.resolve(import.meta.dir, "../static");

export const staticHandler = (
	req: Request,
): Effect.Effect<Response, never, BunFileService> => {
	const url = new URL(req.url);
	// Strip the /static/ prefix to get the relative path
	const relPath = url.pathname.replace(/^\/static\//, "");
	if (!relPath || relPath.includes("..")) {
		return Effect.succeed(new Response(null, { status: 404 }));
	}
	const absPath = path.join(STATIC_DIR, relPath);

	return Effect.gen(function* () {
		const files = yield* BunFileService;
		const exists = yield* files.exists(absPath);
		if (!exists) {
			return new Response(null, { status: 404 });
		}
		const bytes = yield* files
			.readBytes(absPath)
			.pipe(
				Effect.catchAll((_e: InternalError) =>
					Effect.succeed(null as unknown as Uint8Array),
				),
			);
		if (!bytes) {
			return new Response(null, { status: 404 });
		}
		const mime = files.mimeType(absPath) ?? "application/octet-stream";
		return new Response(bytes, {
			status: 200,
			headers: { "Content-Type": mime },
		});
	});
};
