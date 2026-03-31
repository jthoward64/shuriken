import { Effect } from "effect";
import { indexHandler } from "./handlers/index.ts";
import { staticHandler } from "./handlers/static.ts";

// ---------------------------------------------------------------------------
// UI router
// ---------------------------------------------------------------------------

export const uiRouter = (req: Request): Effect.Effect<Response, never> => {
	const url = new URL(req.url);
	const path = url.pathname;

	if (path === "/" || path === "/ui") {
		return indexHandler(req);
	}

	if (path.startsWith("/static/")) {
		return staticHandler(req);
	}

	return Effect.succeed(new Response(null, { status: 404 }));
};
