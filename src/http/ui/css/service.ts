import { Context } from "effect";

// ---------------------------------------------------------------------------
// CssService — the compiled, minified design-system stylesheet.
//
// Tailwind is compiled once at layer construction (server startup) and held in
// memory. The values are served verbatim by the CSS asset handler; nothing
// recompiles per request.
// ---------------------------------------------------------------------------

export interface CssServiceShape {
	/** The compiled + minified CSS bundle. */
	readonly css: string;
	/** Strong ETag (quoted) derived from the css contents. */
	readonly etag: string;
}

export class CssService extends Context.Service<CssService, CssServiceShape>()(
	"CssService",
) {}
