import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import type { InternalError } from "#src/domain/errors.ts";
import { FileService } from "#src/platform/file.ts";

// ---------------------------------------------------------------------------
// Static asset handler — serves files from src/http/ui/static/
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(HERE, "../static");

export const staticHandler = (
	req: Request,
): Effect.Effect<Response, never, FileService> => {
	const url = new URL(req.url);
	// Strip the /static/ prefix to get the relative path
	const relPath = url.pathname.replace(/^\/static\//, "");
	if (!relPath || relPath.includes("..")) {
		return Effect.succeed(new Response(null, { status: 404 }));
	}
	const absPath = path.join(STATIC_DIR, relPath);

	return Effect.gen(function* () {
		const files = yield* FileService;
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
		// Uint8Array is a valid body at runtime; the cast bridges the
		// ArrayBufferLike/ArrayBuffer generic mismatch in lib typings.
		return new Response(bytes as BodyInit, {
			status: 200,
			headers: { "Content-Type": mime },
		});
	});
};
