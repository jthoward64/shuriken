import { Effect } from "effect";
import type { ShareLinkVisibility } from "#src/db/drizzle/schema/index.ts";
import {
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { type CollectionId, isUuid } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { sanitizeReturnTo } from "#src/http/ui/handlers/auth/helpers.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { CollectionEditPage } from "#src/http/ui/view/pages/collections.tsx";
import { renderFragment } from "#src/http/ui/view/render.tsx";
import type { AclService } from "#src/services/acl/index.ts";
import type { CollectionService } from "#src/services/collection/index.ts";
import type { PrincipalService } from "#src/services/principal/index.ts";
import { ShareLinkService } from "#src/services/share-link/service.ts";
import { loadCollectionEditFragmentProps } from "./edit-fragment.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/collections/:collectionId/feeds/add — add the calendar to an
// existing feed from its edit popover. Form fields: feedId, visibility.
// ---------------------------------------------------------------------------

const isVisibility = (raw: string): raw is ShareLinkVisibility =>
	raw === "all" || raw === "limited" || raw === "free_busy";

export const collectionsFeedsAddHandler = (
	req: Request,
	ctx: HttpRequestContext,
	collectionId: CollectionId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | CollectionService | ShareLinkService | PrincipalService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const shareLinkSvc = yield* ShareLinkService;

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const feedIdRaw = form.get("feedId")?.toString().trim() ?? "";
		const visRaw = form.get(`visibility:${collectionId}`)?.toString() ?? "all";
		const visibility = isVisibility(visRaw) ? visRaw : "all";

		if (isUuid(feedIdRaw)) {
			yield* shareLinkSvc.addCalendar(
				feedIdRaw,
				{ userId: principal.userId, principalId: principal.principalId },
				collectionId,
				visibility,
			);
		}

		const returnTo = sanitizeReturnTo(
			form.get("returnTo")?.toString() ?? null,
			"/ui/calendar",
		);

		if (isHtmxRequest(ctx.headers)) {
			// Re-render the popover fragment so the newly-added feed shows up
			// immediately instead of navigating away.
			const props = yield* loadCollectionEditFragmentProps(
				principal,
				collectionId,
			);
			return yield* renderFragment(<CollectionEditPage {...props} />);
		}
		return new Response(null, {
			status: 303,
			headers: { Location: returnTo },
		});
	});
