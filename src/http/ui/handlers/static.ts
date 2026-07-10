import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import type { InternalError } from "#src/domain/errors.ts";
import { HTTP_NOT_MODIFIED, HTTP_OK } from "#src/http/status.ts";
import { strongEtag } from "#src/http/ui/asset-etag.ts";
import { FileService } from "#src/platform/file.ts";

// ---------------------------------------------------------------------------
// Static asset handler — serves files from src/http/ui/static/ (plain assets
// and vendor bundles, as opposed to the startup-compiled CSS/client-JS
// bundles which have their own handlers). Same cache story: a strong ETag
// over the file bytes plus conditional-GET, so repeat browser requests cost a
// cheap 304 instead of a full re-transfer.
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(HERE, "../static");

export const staticHandler = (
	req: Request,
): Effect.Effect<Response, never, FileService> => {
	const url = new URL(req.url);
	// Strip the /static/ prefix to get the relative path
	const relPath = url.pathname.replace(/^\/static\//, "");
	if (!relPath) {
		return Effect.succeed(new Response(null, { status: 404 }));
	}
	// Resolve-then-check-the-relative-path is the actual traversal guard here —
	// robust to how `absPath` is joined, unlike a substring check on `relPath`
	// (which would silently stop guarding anything if this were ever changed
	// from `path.join` to `path.resolve`, since `..` segments could then escape
	// STATIC_DIR before ever being substring-matched).
	const absPath = path.resolve(STATIC_DIR, relPath);
	const relToStatic = path.relative(STATIC_DIR, absPath);
	if (relToStatic.startsWith("..") || path.isAbsolute(relToStatic)) {
		return Effect.succeed(new Response(null, { status: 404 }));
	}

	return Effect.gen(function* () {
		const files = yield* FileService;
		const exists = yield* files.exists(absPath);
		if (!exists) {
			return new Response(null, { status: 404 });
		}
		const bytes = yield* files
			.readBytes(absPath)
			.pipe(
				Effect.catch((_e: InternalError) =>
					Effect.succeed(null as unknown as Uint8Array),
				),
			);
		if (!bytes) {
			return new Response(null, { status: 404 });
		}
		const etag = yield* strongEtag(bytes).pipe(
			Effect.catch((_e: InternalError) => Effect.succeed(null)),
		);

		if (etag && req.headers.get("if-none-match") === etag) {
			return new Response(null, {
				status: HTTP_NOT_MODIFIED,
				headers: { ETag: etag },
			});
		}

		const mime = files.mimeType(absPath) ?? "application/octet-stream";
		const headers: Record<string, string> = {
			"Content-Type": mime,
			"Cache-Control": "public, max-age=300, must-revalidate",
		};
		if (etag) {
			headers.ETag = etag;
		}
		// Uint8Array is a valid body at runtime; the cast bridges the
		// ArrayBufferLike/ArrayBuffer generic mismatch in lib typings.
		return new Response(bytes as BodyInit, {
			status: HTTP_OK,
			headers,
		});
	});
};
