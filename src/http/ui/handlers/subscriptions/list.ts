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
	AclService | AppConfigService | ExternalCalendarRepository | TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const repo = yield* ExternalCalendarRepository;

		const rows = yield* repo.listClaimsWithExternalForPrincipal(
			principal.principalId,
		);

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		const subs = rows.map(({ claim, external }) => ({
			claimId: claim.id,
			collectionId: claim.collectionId,
			url: external.url,
			displayName:
				claim.displaynameOverride ??
				external.defaultDisplayname ??
				external.url,
			color: claim.colorOverride ?? external.defaultColor ?? null,
			syncIntervalS: claim.syncIntervalS,
			lastSyncStatus: external.lastSyncStatus,
			lastSyncAt: external.lastSyncAt,
			lastSyncError: external.lastSyncError,
		}));

		return yield* renderPage(
			"pages/subscriptions/list",
			{ ...nav, pageTitle: "Subscriptions", subscriptions: subs },
			ctx.headers,
		);
	});
