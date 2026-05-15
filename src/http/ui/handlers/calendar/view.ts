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
import type { AclService } from "#src/services/acl/service.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";

// ---------------------------------------------------------------------------
// GET /ui/calendar?collection=<id> — FullCalendar viewer page. The widget
// itself fetches events via /ui/api/calendar/<id>/events?start=&end= so this
// handler only needs to render the chrome and a calendar dropdown switcher.
// ---------------------------------------------------------------------------

export const calendarViewHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | CollectionRepository | TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const collRepo = yield* CollectionRepository;

		const all = yield* collRepo.listByOwner(principal.principalId);
		const calendars = all.filter(
			(c) => c.collectionType === "calendar" && c.deletedAt === null,
		);
		const requested = ctx.url.searchParams.get("collection") ?? "";
		const selected = calendars.find((c) => c.id === requested) ?? calendars[0];

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		return yield* renderPage(
			"pages/calendar/view",
			{
				...nav,
				pageTitle: "Calendar",
				selectedId: selected?.id ?? "",
				selectedDisplay: selected?.displayName ?? selected?.slug ?? "",
				calendars: calendars.map((c) => ({
					id: c.id,
					displayName: c.displayName ?? c.slug,
					selected: c.id === selected?.id,
				})),
				hasCalendar: selected !== undefined,
			},
			ctx.headers,
		);
	});
