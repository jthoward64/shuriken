import { Effect } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { UuidString } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import type { CollectionService } from "#src/services/collection/index.ts";
import type { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import { SubscriptionService } from "#src/services/external-calendar/subscription.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/subscriptions/:claimId/delete
// Authorisation: SubscriptionService.unsubscribe deletes the claim's
// dav_collection via CollectionService, which performs its own ACL checks.
// ---------------------------------------------------------------------------

export const subscriptionsDeleteHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	claimId: UuidString,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	CollectionService | ExternalCalendarRepository | SubscriptionService
> =>
	Effect.gen(function* () {
		yield* requireAuthenticated(ctx.auth);
		const subs = yield* SubscriptionService;

		yield* subs.unsubscribe(claimId);

		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": "/ui/subscriptions" },
			});
		}
		return new Response(null, {
			status: 303,
			headers: { Location: "/ui/subscriptions" },
		});
	});
