import type { VNode } from "preact";

// ---------------------------------------------------------------------------
// UI asset manifest — the single source of truth for the static assets each
// page depends on. The same descriptor list drives BOTH the rendered
// <script>/<link> tags AND the `Link: rel=preload` response header (see
// render.tsx), so a URL is never written twice.
//
// The preload header lets browsers fetch render-critical assets early; a front
// proxy/CDN that understands it (Cloudflare, nginx `http_early_hints`, Caddy)
// promotes it into a real 103 Early Hints interim response. Deno.serve cannot
// emit a 103 itself — its handler returns a single Response — so this
// header-driven approach is how Early Hints is enabled here.
// ---------------------------------------------------------------------------

/** A preloadable static asset. `as` maps to both the `<link rel=preload>` /
 * `Link` header `as` token and how the tag renders (`style` → stylesheet link,
 * `script` → deferred script). */
export interface UiAsset {
	readonly href: string;
	readonly as: "style" | "script";
}

// Assets present on every full page via the base Layout: the design-system
// stylesheet, the render-blocking theme/enhancement script, and self-hosted
// htmx. All three affect first render, so all three preload.
export const BASE_ASSETS: ReadonlyArray<UiAsset> = [
	{ href: "/static/app.css", as: "style" },
	{ href: "/static/ui.js", as: "script" },
	{ href: "/static/vendor/htmx.min.js", as: "script" },
];

// Calendar viewer bundle — FullCalendar (core + plugins) and our boot script
// are inlined by Deno.bundle() into calendar.js itself, so there's nothing
// left to sequence (see pages/calendar/view.tsx and client/calendar.client.ts).
// calendar.css is FullCalendar's structural/layout CSS (skeleton.css),
// extracted from calendar.client.ts's `import "fullcalendar/skeleton.css"` by
// the same bundle step — a real stylesheet, not runtime style injection.
export const CALENDAR_ASSETS: ReadonlyArray<UiAsset> = [
	{ href: "/static/calendar.css", as: "style" },
	{ href: "/static/calendar.js", as: "script" },
	{ href: "/static/reorder.js", as: "script" },
];

// Contacts enhancement script (progress bar + navigate-away guard + delegated
// behaviours) — loaded on the contacts pages that run long HTMX operations.
export const CONTACTS_ASSETS: ReadonlyArray<UiAsset> = [
	{ href: "/static/contacts.js", as: "script" },
	{ href: "/static/reorder.js", as: "script" },
];

/** Render the `<script defer>` / `<link rel=stylesheet>` tags for a bundle.
 * Document order preserves script load order. */
export const AssetTags = ({
	assets,
}: {
	assets: ReadonlyArray<UiAsset>;
}): VNode => (
	<>
		{assets.map((a) =>
			a.as === "style" ? (
				<link key={a.href} rel="stylesheet" href={a.href} />
			) : (
				<script key={a.href} src={a.href} defer />
			),
		)}
	</>
);

/** Build a `Link` response-header value advertising each asset as a preload
 * (RFC 8288 field-value; comma-separated). Empty string for an empty list so
 * callers can skip setting the header. */
export const preloadLinkHeader = (assets: ReadonlyArray<UiAsset>): string =>
	assets.map((a) => `<${a.href}>; rel=preload; as=${a.as}`).join(", ");
