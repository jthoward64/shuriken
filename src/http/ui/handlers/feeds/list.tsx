import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { FeedsListPage } from "#src/http/ui/view/pages/feeds.tsx";
import { renderFragment, renderPage } from "#src/http/ui/view/render.tsx";
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
	AclService | AppConfigService | ShareLinkService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const svc = yield* ShareLinkService;

		const summaries = yield* svc.listForUser(principal.userId);

		const feeds = summaries.map(({ link, calendars }) => ({
			id: link.id,
			displayName: link.displayName ?? "(untitled)",
			enabled: link.enabled,
			expiresAt: link.expiresAt ? link.expiresAt.toString() : null,
			calendarCount: calendars.length,
			feedUrl: `/feed/${link.token}.ics`,
		}));

		// HTMX = the calendar sidebar trigger: return just the popover fragment.
		if (isHtmxRequest(ctx.headers)) {
			return yield* renderFragment(
				<FeedsListPage feeds={feeds} variant="popover" />,
			);
		}

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		return yield* renderPage(<FeedsListPage feeds={feeds} />, {
			headers: ctx.headers,
			title: "Feeds",
			nav,
		});
	});
