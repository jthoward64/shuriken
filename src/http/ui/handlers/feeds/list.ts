import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import type { AclService } from "#src/services/acl/index.ts";
import { ShareLinkService } from "#src/services/share-link/service.ts";

// ---------------------------------------------------------------------------
// GET /ui/feeds — list the current user's share links.
// ---------------------------------------------------------------------------

export const feedsListHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | ShareLinkService | TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const svc = yield* ShareLinkService;

		const summaries = yield* svc.listForUser(principal.userId);

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		const feeds = summaries.map(({ link, calendars }) => ({
			id: link.id,
			token: link.token,
			displayName: link.displayName ?? "(untitled)",
			enabled: link.enabled,
			expiresAt: link.expiresAt ? link.expiresAt.toString() : null,
			calendarCount: calendars.length,
			feedUrl: `/feed/${link.token}.ics`,
		}));

		return yield* renderPage(
			"pages/feeds/list",
			{ ...nav, pageTitle: "Feeds", feeds },
			ctx.headers,
		);
	});
