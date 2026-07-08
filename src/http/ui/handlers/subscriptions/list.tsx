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
import { SubscriptionsListPage } from "#src/http/ui/view/pages/subscriptions.tsx";
import { renderFragment, renderPage } from "#src/http/ui/view/render.tsx";
import type { AclService } from "#src/services/acl/index.ts";
import { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";

// ---------------------------------------------------------------------------
// GET /ui/subscriptions — lists the current user's external-calendar
// subscriptions. Joined with the parent feed row so the table shows
// last-sync state.
// ---------------------------------------------------------------------------

export const subscriptionsListHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | ExternalCalendarRepository
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const repo = yield* ExternalCalendarRepository;

		const rows = yield* repo.listClaimsWithExternalForPrincipal(
			principal.principalId,
		);

		const subscriptions = rows.map(({ claim, external }) => ({
			claimId: claim.id,
			url: external.url,
			displayName:
				claim.displaynameOverride ??
				external.defaultDisplayname ??
				external.url,
			color: claim.colorOverride ?? external.defaultColor ?? null,
			lastSyncStatus: external.lastSyncStatus,
			lastSyncAt:
				external.lastSyncAt === null ? null : external.lastSyncAt.toString(),
			lastSyncError: external.lastSyncError ?? null,
		}));

		// HTMX = the calendar sidebar trigger: return just the popover fragment.
		if (isHtmxRequest(ctx.headers)) {
			return yield* renderFragment(
				<SubscriptionsListPage
					subscriptions={subscriptions}
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
			<SubscriptionsListPage subscriptions={subscriptions} />,
			{ headers: ctx.headers, title: "Subscriptions", nav },
		);
	});
