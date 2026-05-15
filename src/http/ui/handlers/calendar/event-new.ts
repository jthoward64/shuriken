import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { CollectionId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import type { AclService } from "#src/services/acl/service.ts";
import { emptyEventForm } from "#src/services/cal-edit/types.ts";

// ---------------------------------------------------------------------------
// GET /ui/calendar/:collectionId/events/new?start=&end=&allDay=
// ---------------------------------------------------------------------------

export const eventNewHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	collectionId: CollectionId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;

		const start = ctx.url.searchParams.get("start") ?? "";
		const end = ctx.url.searchParams.get("end") ?? "";
		const allDay = ctx.url.searchParams.get("allDay") === "true";

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);
		return yield* renderPage(
			"pages/calendar/event-form",
			{
				...nav,
				pageTitle: "New event",
				mode: "new",
				collectionId,
				form: { ...emptyEventForm, start, end, allDay },
				action: `/ui/api/calendar/${collectionId}/events/create`,
				backHref: `/ui/calendar?collection=${collectionId}`,
			},
			ctx.headers,
		);
	});
