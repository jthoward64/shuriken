import { Effect, Match, Option } from "effect";
import { AppConfigService } from "#src/config.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	HTTP_CONFLICT,
	HTTP_FORBIDDEN,
	HTTP_NOT_FOUND,
	HTTP_OK,
	HTTP_SEE_OTHER,
	HTTP_UNAUTHORIZED,
} from "#src/http/status.ts";
import { clientJsHandler } from "#src/http/ui/handlers/client-js.ts";
import { cssAssetHandler } from "#src/http/ui/handlers/css.ts";
import { staticHandler } from "#src/http/ui/handlers/static.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { UI_API_POST_MATCHERS } from "#src/http/ui/routes/api-post.ts";
import { UI_PAGE_MATCHERS } from "#src/http/ui/routes/pages.ts";
import type {
	UiError,
	UiRoute,
	UiServices,
} from "#src/http/ui/routes/types.ts";
import {
	renderForbidden,
	renderNotFound,
	renderServerError,
} from "#src/http/ui/view/shell/render.tsx";

// ---------------------------------------------------------------------------
// Error → Response mapping for UI errors
// ---------------------------------------------------------------------------

const mapUiError = (
	err: UiError,
	ctx: HttpRequestContext,
	basicAuthEnabled: boolean,
	oidcEnabled: boolean,
): Effect.Effect<Response, never> =>
	Match.value(err).pipe(
		Match.tag("DavError", (e) => {
			if (e.status === HTTP_UNAUTHORIZED) {
				// Browser UI: send unauthenticated users to the OIDC login page rather
				// than provoking a Basic-auth popup. DAV/API 401s (handled in the
				// top-level router) still advertise Basic for client compatibility.
				if (oidcEnabled) {
					const loginUrl = `/ui/auth/login?returnTo=${encodeURIComponent(
						ctx.url.pathname,
					)}`;
					if (isHtmxRequest(ctx.headers)) {
						return Effect.succeed(
							new Response(null, {
								status: HTTP_OK,
								headers: { "HX-Redirect": loginUrl },
							}),
						);
					}
					return Effect.succeed(
						new Response(null, {
							status: HTTP_SEE_OTHER,
							headers: { Location: loginUrl },
						}),
					);
				}
				if (basicAuthEnabled) {
					return Effect.succeed(
						new Response(null, {
							status: HTTP_UNAUTHORIZED,
							headers: { "WWW-Authenticate": 'Basic realm="shuriken"' },
						}),
					);
				}
				return Effect.succeed(
					new Response(null, {
						status: HTTP_SEE_OTHER,
						headers: { Location: "/ui/profile" },
					}),
				);
			}
			if (e.status === HTTP_FORBIDDEN) {
				return renderForbidden(ctx.headers);
			}
			if (e.status === HTTP_NOT_FOUND) {
				return renderNotFound(ctx.headers);
			}
			return Effect.succeed(
				new Response(e.message ?? "Error", { status: e.status }),
			);
		}),
		Match.tag("DatabaseError", "InternalError", (e) =>
			Effect.gen(function* () {
				yield* Effect.logError("ui handler failed", { cause: e.cause });
				return yield* renderServerError(ctx.headers);
			}),
		),
		Match.tag("ConflictError", (e) =>
			Effect.succeed(new Response(e.message, { status: HTTP_CONFLICT })),
		),
		Match.exhaustive,
	);

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

const UI_PATH_PREFIX = "/ui/";
const UI_PATH_PREFIX_LEN = UI_PATH_PREFIX.length;

// The path below /ui, or none when the request is not a UI route at all
const getUiPath = (pathname: string): Option.Option<string> => {
	if (pathname.startsWith(UI_PATH_PREFIX)) {
		return Option.some(pathname.slice(UI_PATH_PREFIX_LEN));
	}
	if (pathname === "/ui" || pathname === "/") {
		return Option.some("");
	}
	return Option.none();
};

// Run a UI handler, mapping its typed failures onto response pages
const handleUiErrors = Effect.fn("ui.handleErrors")(function* (
	eff: Effect.Effect<Response, UiError, UiServices>,
	ctx: HttpRequestContext,
) {
	const config = yield* AppConfigService;
	return yield* Effect.catch(eff, (err) =>
		mapUiError(err, ctx, config.auth.basicAuthEnabled, config.auth.oidcEnabled),
	);
});

// ---------------------------------------------------------------------------
// Static assets
// ---------------------------------------------------------------------------

// Browser scripts (and the CSS extracted from them) bundled at startup
const BUNDLED_ASSETS: ReadonlyArray<string> = [
	"calendar.js",
	"calendar.css",
	"reorder.js",
	"forms.js",
	"date-picker.js",
	"embed-widget.js",
	"embed-widget.css",
];

// Asset routes, checked before /ui so a bundled build wins over a stale on-disk copy
const matchStaticRoute = (
	req: Request,
	pathname: string,
): Option.Option<Effect.Effect<Response, never, UiServices>> => {
	// Design-system stylesheet, compiled in memory at startup and served with a strong ETag
	if (pathname === "/static/app.css") {
		return Option.some(cssAssetHandler(req));
	}
	const bundled = BUNDLED_ASSETS.find((name) => pathname === `/static/${name}`);
	if (bundled !== undefined) {
		return Option.some(clientJsHandler(req, bundled));
	}
	if (pathname.startsWith("/static/")) {
		return Option.some(
			Effect.catch(staticHandler(req), () =>
				Effect.succeed(new Response(null, { status: HTTP_NOT_FOUND })),
			),
		);
	}
	return Option.none();
};

// ---------------------------------------------------------------------------
// UI router
// ---------------------------------------------------------------------------

// Route groups in priority order; the first that matches handles the request
const UI_ROUTE_MATCHERS: ReadonlyArray<
	(
		route: UiRoute,
	) => Option.Option<Effect.Effect<Response, UiError, UiServices>>
> = [...UI_PAGE_MATCHERS, ...UI_API_POST_MATCHERS];

// Dispatch a parsed UI path, or render the not-found page when nothing matches
const dispatchUiRoute = (
	route: UiRoute,
): Effect.Effect<Response, never, UiServices> =>
	Option.match(
		UI_ROUTE_MATCHERS.reduce<
			Option.Option<Effect.Effect<Response, UiError, UiServices>>
		>(
			(found, match) => Option.orElse(found, () => match(route)),
			Option.none(),
		),
		{
			onSome: (eff) => handleUiErrors(eff, route.ctx),
			onNone: () => renderNotFound(route.ctx.headers),
		},
	);

export const uiRouter = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<Response, never, UiServices> =>
	Option.match(matchStaticRoute(req, ctx.url.pathname), {
		onSome: (asset) => asset,
		onNone: () =>
			Option.match(getUiPath(ctx.url.pathname), {
				onSome: (uiPath) =>
					dispatchUiRoute({
						req,
						ctx,
						method: req.method.toUpperCase(),
						segments: uiPath.split("/").filter((segment) => segment !== ""),
					}),
				onNone: () =>
					Effect.succeed(new Response(null, { status: HTTP_NOT_FOUND })),
			}),
	});
