/** biome-ignore-all lint/style/noMagicNumbers: interval values are self-describing */
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
import {
	HOLIDAY_PRESETS,
	HOLIDAY_SYNC_INTERVAL_S,
} from "#src/services/external-calendar/holiday-presets.ts";

const ONE_DAY_S = 24 * 60 * 60;

const SYNC_INTERVAL_OPTIONS: ReadonlyArray<{
	readonly seconds: number;
	readonly label: string;
}> = [
	{ seconds: 60 * 60, label: "Every hour" },
	{ seconds: 12 * 60 * 60, label: "Every 12 hours" },
	{ seconds: ONE_DAY_S, label: "Once a day" },
	{ seconds: 5 * ONE_DAY_S, label: "Every 5 days" },
	{ seconds: 10 * ONE_DAY_S, label: "Every 10 days" },
	{ seconds: 30 * ONE_DAY_S, label: "Every 30 days" },
	{ seconds: HOLIDAY_SYNC_INTERVAL_S, label: "Every 50 days" },
	{ seconds: 90 * ONE_DAY_S, label: "Every 90 days" },
];

// ---------------------------------------------------------------------------
// GET /ui/subscriptions/new — subscription form, optionally pre-populated
// from a holiday preset via ?preset=<id>.
// ---------------------------------------------------------------------------

export const subscriptionsNewHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;

		const presetId = ctx.url.searchParams.get("preset") ?? undefined;
		const preset = presetId
			? HOLIDAY_PRESETS.find((p) => p.id === presetId)
			: undefined;

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		const intervals = SYNC_INTERVAL_OPTIONS.map((o) => ({
			...o,
			selected: o.seconds === (preset ? HOLIDAY_SYNC_INTERVAL_S : ONE_DAY_S),
		}));

		return yield* renderPage(
			"pages/subscriptions/new",
			{
				...nav,
				pageTitle: "Subscribe to a calendar",
				presets: HOLIDAY_PRESETS,
				preset,
				intervals,
			},
			ctx.headers,
		);
	});
