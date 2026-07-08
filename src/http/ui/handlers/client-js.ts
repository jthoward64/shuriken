import { Effect } from "effect";
import {
	HTTP_NOT_FOUND,
	HTTP_NOT_MODIFIED,
	HTTP_OK,
} from "#src/http/status.ts";
import { ClientJsService } from "#src/http/ui/client/index.ts";

// ---------------------------------------------------------------------------
// GET /static/<name> — serves a browser script (or a CSS file extracted from
// one, e.g. calendar.css from calendar.client.ts's `import
// "fullcalendar/skeleton.css"`) bundled at startup. Same cache story as the
// design-system stylesheet: strong ETag + conditional-GET so browsers
// revalidate with a cheap 304. Bytes change only across deploys (a new process
// rebundles), which the ETag captures.
// ---------------------------------------------------------------------------

export const clientJsHandler = (
	req: Request,
	name: string,
): Effect.Effect<Response, never, ClientJsService> =>
	Effect.gen(function* () {
		const { assets } = yield* ClientJsService;
		const asset = assets.get(name);
		if (!asset) {
			return new Response(null, { status: HTTP_NOT_FOUND });
		}

		if (req.headers.get("if-none-match") === asset.etag) {
			return new Response(null, {
				status: HTTP_NOT_MODIFIED,
				headers: { ETag: asset.etag },
			});
		}

		return new Response(asset.code, {
			status: HTTP_OK,
			headers: {
				"Content-Type": name.endsWith(".css")
					? "text/css; charset=utf-8"
					: "text/javascript; charset=utf-8",
				ETag: asset.etag,
				"Cache-Control": "public, max-age=300, must-revalidate",
			},
		});
	});
