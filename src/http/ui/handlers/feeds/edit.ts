import { Effect, Option } from "effect";
import { AppConfigService } from "#src/config.ts";
import {
	type DatabaseError,
	type DavError,
	type InternalError,
	notFound,
} from "#src/domain/errors.ts";
import type { UuidString } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import type { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { ShareLinkService } from "#src/services/share-link/service.ts";

// ---------------------------------------------------------------------------
// GET /ui/feeds/:id — edit an existing share link.
// ---------------------------------------------------------------------------

export const feedsEditHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	id: UuidString,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclService
	| AppConfigService
	| CollectionService
	| ShareLinkService
	| TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const svc = yield* ShareLinkService;
		const collSvc = yield* CollectionService;

		const summaryOpt = yield* svc.getById(id, {
			userId: principal.userId,
			principalId: principal.principalId,
		});
		if (Option.isNone(summaryOpt)) {
			return yield* Effect.fail(notFound("share link not found"));
		}
		const { link, calendars: linkedCalendars } = summaryOpt.value;

		const ownedCollections = yield* collSvc.listByOwner(principal.principalId);
		const linkedIds = new Set(linkedCalendars.map((c) => c.calendarId));
		const allCalendars = ownedCollections
			.filter((c) => c.collectionType === "calendar" && c.deletedAt === null)
			.map((c) => {
				const linked = linkedCalendars.find((lc) => lc.calendarId === c.id);
				return {
					id: c.id,
					displayName: c.displayName ?? c.slug,
					linked: linkedIds.has(c.id),
					visibility: linked?.visibility ?? "all",
				};
			});

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		return yield* renderPage(
			"pages/feeds/edit",
			{
				...nav,
				pageTitle: link.displayName ?? "Feed",
				feed: {
					id: link.id,
					token: link.token,
					displayName: link.displayName ?? "",
					enabled: link.enabled,
					expiresAt: link.expiresAt ? link.expiresAt.toString() : "",
					feedUrl: `/feed/${link.token}.ics`,
				},
				calendars: allCalendars,
			},
			ctx.headers,
		);
	});
