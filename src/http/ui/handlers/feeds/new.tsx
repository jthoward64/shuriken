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
import { FeedNewPage } from "#src/http/ui/view/pages/feeds.tsx";
import { renderFragment, renderPage } from "#src/http/ui/view/render.tsx";
import type { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/feeds/new — render the form to create a new share link.
// ---------------------------------------------------------------------------

export const feedsNewHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | CollectionService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const collSvc = yield* CollectionService;

		const ownedCollections = yield* collSvc.listByOwner(principal.principalId);
		const calendars = ownedCollections
			.filter((c) => c.collectionType === "calendar" && c.deletedAt === null)
			.map((c) => ({ id: c.id, displayName: c.displayName ?? c.slug }));

		const preselectedCalendarId =
			ctx.url.searchParams.get("calendar") ?? undefined;

		// The calendar sidebar's edit popover links here to start a new feed
		// containing that calendar; render just the popover fragment for it.
		if (isHtmxRequest(ctx.headers)) {
			return yield* renderFragment(
				<FeedNewPage
					calendars={calendars}
					preselectedCalendarId={preselectedCalendarId}
					variant="popover"
				/>,
			);
		}

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		return yield* renderPage(
			<FeedNewPage
				calendars={calendars}
				preselectedCalendarId={preselectedCalendarId}
			/>,
			{
				headers: ctx.headers,
				title: "New feed",
				nav,
			},
		);
	});
