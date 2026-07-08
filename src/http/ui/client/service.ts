import { Context } from "effect";

// ---------------------------------------------------------------------------
// ClientJsService — the bundled browser scripts.
//
// Client TypeScript entry points are bundled once at layer construction
// (server startup) and held in memory, keyed by their served filename (e.g.
// "calendar.js"). The values are served verbatim by the client-JS asset
// handler; nothing rebundles per request. Mirrors CssService.
// ---------------------------------------------------------------------------

export interface ClientAsset {
	/** The bundled, minified script or CSS source. */
	readonly code: string;
	/** Strong ETag (quoted) derived from the code. */
	readonly etag: string;
}

export interface ClientJsServiceShape {
	/**
	 * Bundled assets keyed by served filename (e.g. "calendar.js"). Also holds
	 * CSS extracted from entries that import a `.css` file as a side effect
	 * (e.g. "calendar.css", from calendar.client.ts's
	 * `import "fullcalendar/skeleton.css"`) — same map, same asset shape, the
	 * content-type is decided at the serving edge by file extension.
	 */
	readonly assets: ReadonlyMap<string, ClientAsset>;
}

export class ClientJsService extends Context.Service<
	ClientJsService,
	ClientJsServiceShape
>()("ClientJsService") {}
