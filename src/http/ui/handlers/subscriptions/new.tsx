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
import { SubscriptionsNewPage } from "#src/http/ui/view/pages/subscriptions.tsx";
import { renderFragment, renderPage } from "#src/http/ui/view/render.tsx";
import type { AclService } from "#src/services/acl/index.ts";
import {
	DEFAULT_SYNC_INTERVAL_S,
	HOLIDAY_PRESETS,
	HOLIDAY_SYNC_INTERVAL_S,
	SYNC_INTERVAL_OPTIONS,
} from "#src/services/external-calendar/holiday-presets.ts";

// ---------------------------------------------------------------------------
// GET /ui/subscriptions/new — subscription form, optionally pre-populated
// from a holiday preset via ?preset=<id>. Reached from the standalone
// Subscriptions page and the Feeds/Subscriptions popover (both navigate here
// via HTMX into the shared calendar popover); the calendar page's "Add
// calendar" menu instead renders this form inline (see
// handlers/calendar/view.tsx) so it opens with no JS.
// ---------------------------------------------------------------------------

export const subscriptionsNewHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;

		const presetId = ctx.url.searchParams.get("preset") ?? undefined;
		const preset = presetId
			? HOLIDAY_PRESETS.find((p) => p.id === presetId)
			: undefined;

		const intervals = SYNC_INTERVAL_OPTIONS.map((o) => ({
			...o,
			selected:
				o.seconds ===
				(preset ? HOLIDAY_SYNC_INTERVAL_S : DEFAULT_SYNC_INTERVAL_S),
		}));

		// HTMX = navigating into the Subscribe form from the Feeds/Subscriptions
		// popover: return the popover fragment.
		if (isHtmxRequest(ctx.headers)) {
			return yield* renderFragment(
				<SubscriptionsNewPage
					presets={HOLIDAY_PRESETS}
					preset={preset}
					intervals={intervals}
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
			<SubscriptionsNewPage
				presets={HOLIDAY_PRESETS}
				preset={preset}
				intervals={intervals}
			/>,
			{ headers: ctx.headers, title: "Subscribe to a calendar", nav },
		);
	});
