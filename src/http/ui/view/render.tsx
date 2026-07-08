import { Effect } from "effect";
import type { ComponentChildren, VNode } from "preact";
import { render } from "preact-render-to-string";
import { InternalError } from "#src/domain/errors.ts";
import {
	HTTP_FORBIDDEN,
	HTTP_INTERNAL_SERVER_ERROR,
	HTTP_NOT_FOUND,
	HTTP_OK,
} from "#src/http/status.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import type { NavContext } from "#src/http/ui/helpers/nav-context.ts";
import { BASE_ASSETS, preloadLinkHeader, type UiAsset } from "./assets.tsx";
import { Layout } from "./layout.tsx";
import {
	ForbiddenPage,
	NotFoundPage,
	ServerErrorPage,
} from "./pages/errors.tsx";

// ---------------------------------------------------------------------------
// JSX render helpers — turn typed page components into HTML Responses inside
// Effect. Full-page renders wrap the content in the base Layout; HTMX requests
// return just the content fragment (no chrome).
// ---------------------------------------------------------------------------

const toHtml = (node: VNode): Effect.Effect<string, InternalError> =>
	Effect.try({
		try: () => render(node),
		catch: (cause) => new InternalError({ cause }),
	});

const htmlResponse = (
	html: string,
	status: number,
	// Optional `Link` header advertising preloadable assets (promoted to a 103
	// Early Hints response by a supporting front proxy; see assets.tsx).
	link?: string,
): Response => {
	const headers = new Headers({ "Content-Type": "text/html; charset=utf-8" });
	if (link !== undefined && link !== "") {
		headers.set("Link", link);
	}
	return new Response(html, { status, headers });
};

export interface PageOptions {
	readonly headers: Headers;
	/** Document <title> (before the " — Shuriken" suffix). */
	readonly title: string;
	/** Navigation context; omit for chrome-less pages (e.g. pre-auth errors). */
	readonly nav?: NavContext;
	/** HTTP status (defaults to 200). */
	readonly status?: number;
	/** Extra nodes injected into <head> (e.g. page-specific inline data). */
	readonly extraHead?: ComponentChildren;
	/** Page-specific assets to advertise via the `Link: rel=preload` header
	 * (on full-page renders only), on top of the always-present BASE_ASSETS.
	 * See assets.tsx. */
	readonly preload?: ReadonlyArray<UiAsset>;
	/** Render the content full-width (no centered max-w-7xl cap) — for the
	 * calendar/contacts sidebar layouts. */
	readonly wide?: boolean;
	/** Lock the shell to the viewport height on lg+ so the page doesn't scroll
	 * (the calendar/contacts sidebar layouts scroll internally instead). */
	readonly fill?: boolean;
	/** "embed" suppresses the top app-nav bar for chrome-less iframe embedding
	 * (see Layout). Defaults to "full". */
	readonly chrome?: "full" | "embed";
}

// Render a page component. Wraps it in the Layout for normal requests; returns
// the bare fragment for HTMX so it can be swapped into the current document.
export const renderPage = (
	content: VNode,
	opts: PageOptions,
): Effect.Effect<Response, InternalError> =>
	Effect.gen(function* () {
		const status = opts.status ?? HTTP_OK;
		// HTMX fragments swap into an already-loaded document, so their assets
		// are present — no preload header (and no Layout chrome).
		if (isHtmxRequest(opts.headers)) {
			return htmlResponse(yield* toHtml(content), status);
		}
		const doc = yield* toHtml(
			<Layout
				title={opts.title}
				nav={opts.nav}
				extraHead={opts.extraHead}
				wide={opts.wide}
				fill={opts.fill}
				chrome={opts.chrome}
			>
				{content}
			</Layout>,
		);
		const link = preloadLinkHeader([...BASE_ASSETS, ...(opts.preload ?? [])]);
		return htmlResponse(`<!DOCTYPE html>${doc}`, status, link);
	});

// Render a standalone fragment (no layout) — for HTMX partial swaps that are not
// full pages (list rows, form-result panels, etc.).
export const renderFragment = (
	content: VNode,
): Effect.Effect<Response, InternalError> =>
	toHtml(content).pipe(Effect.map((html) => htmlResponse(html, HTTP_OK)));

// ---------------------------------------------------------------------------
// Error pages — never-failing renders (fall back to plain text if rendering
// itself fails) so the router can use them without extra error handling.
// ---------------------------------------------------------------------------

const renderErrorPage = (
	status: number,
	title: string,
	content: VNode,
	headers: Headers,
): Effect.Effect<Response, never> =>
	renderPage(content, { headers, title, status }).pipe(
		Effect.catch(() => Effect.succeed(new Response(title, { status }))),
	);

export const renderForbidden = (
	headers: Headers,
): Effect.Effect<Response, never> =>
	renderErrorPage(HTTP_FORBIDDEN, "Forbidden", <ForbiddenPage />, headers);

export const renderNotFound = (
	headers: Headers,
): Effect.Effect<Response, never> =>
	renderErrorPage(HTTP_NOT_FOUND, "Not Found", <NotFoundPage />, headers);

export const renderServerError = (
	headers: Headers,
): Effect.Effect<Response, never> =>
	renderErrorPage(
		HTTP_INTERNAL_SERVER_ERROR,
		"Server Error",
		<ServerErrorPage />,
		headers,
	);
