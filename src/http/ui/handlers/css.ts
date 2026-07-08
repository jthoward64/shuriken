import { Effect } from "effect";
import { HTTP_NOT_MODIFIED, HTTP_OK } from "#src/http/status.ts";
import { CssService } from "#src/http/ui/css/index.ts";

// ---------------------------------------------------------------------------
// GET /static/app.css — serves the design-system stylesheet compiled at
// startup. Cache-friendly: strong ETag + conditional-GET so browsers revalidate
// with a cheap 304 rather than re-downloading. The bytes only change across
// deploys (a new process recompiles), which the ETag captures.
// ---------------------------------------------------------------------------

export const cssAssetHandler = (
	req: Request,
): Effect.Effect<Response, never, CssService> =>
	Effect.gen(function* () {
		const { css, etag } = yield* CssService;

		if (req.headers.get("if-none-match") === etag) {
			return new Response(null, {
				status: HTTP_NOT_MODIFIED,
				headers: { ETag: etag },
			});
		}

		return new Response(css, {
			status: HTTP_OK,
			headers: {
				"Content-Type": "text/css; charset=utf-8",
				ETag: etag,
				"Cache-Control": "public, max-age=300, must-revalidate",
			},
		});
	});
