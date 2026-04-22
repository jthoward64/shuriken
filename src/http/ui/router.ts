import { Effect, Match } from "effect";
import type { AppConfigService } from "#src/config.ts";
import type {
	ConflictError,
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	HTTP_CONFLICT,
	HTTP_FORBIDDEN,
	HTTP_INTERNAL_SERVER_ERROR,
	HTTP_NOT_FOUND,
	HTTP_OK,
	HTTP_SEE_OTHER,
	HTTP_UNAUTHORIZED,
} from "#src/http/status.ts";
import { groupsCreateHandler } from "#src/http/ui/api/groups/create.ts";
import { groupsDeleteHandler } from "#src/http/ui/api/groups/delete.ts";
import { groupsMembersHandler } from "#src/http/ui/api/groups/members.ts";
import { groupsUpdateHandler } from "#src/http/ui/api/groups/update.ts";
import { usersCreateHandler } from "#src/http/ui/api/users/create.ts";
import { usersDeleteHandler } from "#src/http/ui/api/users/delete.ts";
import { usersSetPasswordHandler } from "#src/http/ui/api/users/set-password.ts";
import { usersUpdateHandler } from "#src/http/ui/api/users/update.ts";
import { groupsEditHandler } from "#src/http/ui/handlers/groups/edit.ts";
import { groupsListHandler } from "#src/http/ui/handlers/groups/list.ts";
import { groupsNewHandler } from "#src/http/ui/handlers/groups/new.ts";
import { staticHandler } from "#src/http/ui/handlers/static.ts";
import { usersEditHandler } from "#src/http/ui/handlers/users/edit.ts";
import { usersListHandler } from "#src/http/ui/handlers/users/list.ts";
import { usersNewHandler } from "#src/http/ui/handlers/users/new.ts";
import type { BunFileService } from "#src/platform/file.ts";
import type { AclService } from "#src/services/acl/index.ts";
import type { GroupService } from "#src/services/group/index.ts";
import type { PrincipalService } from "#src/services/principal/index.ts";
import type { UserService } from "#src/services/user/index.ts";
import { profileHandler } from "./handlers/profile.ts";
import { renderError } from "./helpers/render-page.ts";
import type { TemplateService } from "./template/index.ts";

// ---------------------------------------------------------------------------
// UI service union — all services the UI router and its handlers can use
// ---------------------------------------------------------------------------

export type UiServices =
	| AppConfigService
	| AclService
	| BunFileService
	| GroupService
	| PrincipalService
	| TemplateService
	| UserService;

// ---------------------------------------------------------------------------
// Error → Response mapping for UI errors
// ---------------------------------------------------------------------------

type UiError = DavError | DatabaseError | InternalError | ConflictError;

const mapUiError = (
	err: UiError,
	ctx: HttpRequestContext,
): Effect.Effect<Response, never, TemplateService> =>
	Match.value(err).pipe(
		Match.tag("DavError", (e) => {
			if (e.status === HTTP_UNAUTHORIZED) {
				return Effect.succeed(
					new Response(null, {
						status: HTTP_SEE_OTHER,
						headers: { Location: "/ui/profile" },
					}),
				);
			}
			if (e.status === HTTP_FORBIDDEN) {
				return renderError(
					HTTP_FORBIDDEN,
					"pages/errors/403",
					{ pageTitle: "Forbidden" },
					ctx.headers,
				).pipe(
					Effect.orElse(() =>
						Effect.succeed(
							new Response("Forbidden", { status: HTTP_FORBIDDEN }),
						),
					),
				);
			}
			if (e.status === HTTP_NOT_FOUND) {
				return renderError(
					HTTP_NOT_FOUND,
					"pages/errors/404",
					{ pageTitle: "Not Found" },
					ctx.headers,
				).pipe(
					Effect.orElse(() =>
						Effect.succeed(
							new Response("Not Found", { status: HTTP_NOT_FOUND }),
						),
					),
				);
			}
			return Effect.succeed(
				new Response(e.message ?? "Error", { status: e.status }),
			);
		}),
		Match.tag("DatabaseError", "InternalError", (e) =>
			Effect.logError("ui handler failed", {
				cause: (e as { cause: unknown }).cause,
			}).pipe(
				Effect.andThen(
					renderError(
						HTTP_INTERNAL_SERVER_ERROR,
						"pages/errors/500",
						{ pageTitle: "Server Error" },
						ctx.headers,
					).pipe(
						Effect.orElse(() =>
							Effect.succeed(
								new Response("Internal Server Error", {
									status: HTTP_INTERNAL_SERVER_ERROR,
								}),
							),
						),
					),
				),
			),
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

const getUiPath = (pathname: string): string | null => {
	if (pathname.startsWith(UI_PATH_PREFIX)) {
		return pathname.slice(UI_PATH_PREFIX_LEN);
	}
	if (pathname === "/ui" || pathname === "/") {
		return "";
	}
	return null;
};

// ---------------------------------------------------------------------------
// UI router
// ---------------------------------------------------------------------------

export const uiRouter = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<Response, never, UiServices> => {
	const { pathname } = ctx.url;
	const method = req.method.toUpperCase();

	if (pathname.startsWith("/static/")) {
		return staticHandler(req).pipe(
			Effect.catchAll(() =>
				Effect.succeed(new Response(null, { status: HTTP_NOT_FOUND })),
			),
		);
	}

	const uiPath = getUiPath(pathname);
	if (uiPath === null) {
		return Effect.succeed(new Response(null, { status: HTTP_NOT_FOUND }));
	}

	const segments = uiPath.split("/").filter(Boolean) as Array<string>;
	const [seg0, seg1, seg2, seg3] = segments;

	const handle = (
		eff: Effect.Effect<Response, UiError, UiServices>,
	): Effect.Effect<Response, never, UiServices> =>
		eff.pipe(Effect.catchAll((err) => mapUiError(err, ctx)));

	const notFound = (): Effect.Effect<Response, never, UiServices> =>
		renderError(
			HTTP_NOT_FOUND,
			"pages/errors/404",
			{ pageTitle: "Not Found" },
			ctx.headers,
		).pipe(
			Effect.catchAll(() =>
				Effect.succeed(new Response("Not Found", { status: HTTP_NOT_FOUND })),
			),
		);

	// Home
	if (!seg0 && method === "GET") {
		return handle(
			renderError(HTTP_OK, "pages/home", { pageTitle: "Home" }, ctx.headers),
		);
	}

	// Profile
	if (seg0 === "profile" && !seg1 && method === "GET") {
		return handle(profileHandler(req, ctx));
	}

	// Users (GET pages)
	if (seg0 === "users" && method === "GET") {
		if (!seg1) {
			return handle(usersListHandler(req, ctx));
		}
		if (seg1 === "new" && !seg2) {
			return handle(usersNewHandler(req, ctx));
		}
		if (seg1 && !seg2) {
			return handle(usersEditHandler(req, ctx, seg1 as Slug));
		}
	}

	// Groups (GET pages)
	if (seg0 === "groups" && method === "GET") {
		if (!seg1) {
			return handle(groupsListHandler(req, ctx));
		}
		if (seg1 === "new" && !seg2) {
			return handle(groupsNewHandler(req, ctx));
		}
		if (seg1 && !seg2) {
			return handle(groupsEditHandler(req, ctx, seg1 as Slug));
		}
	}

	// API endpoints (POST)
	if (seg0 === "api" && method === "POST") {
		if (seg1 === "users") {
			if (seg2 === "create" && !seg3) {
				return handle(usersCreateHandler(req, ctx));
			}
			if (seg2 && seg3 === "update") {
				return handle(usersUpdateHandler(req, ctx, seg2 as Slug));
			}
			if (seg2 && seg3 === "delete") {
				return handle(usersDeleteHandler(req, ctx, seg2 as Slug));
			}
			if (seg2 && seg3 === "set-password") {
				return handle(usersSetPasswordHandler(req, ctx, seg2 as Slug));
			}
		}
		if (seg1 === "groups") {
			if (seg2 === "create" && !seg3) {
				return handle(groupsCreateHandler(req, ctx));
			}
			if (seg2 && seg3 === "update") {
				return handle(groupsUpdateHandler(req, ctx, seg2 as Slug));
			}
			if (seg2 && seg3 === "delete") {
				return handle(groupsDeleteHandler(req, ctx, seg2 as Slug));
			}
			if (seg2 && seg3 === "members") {
				return handle(groupsMembersHandler(req, ctx, seg2 as Slug));
			}
		}
	}

	return notFound();
};
