import { Effect } from "effect";
import {
	badRequest,
	type DatabaseError,
	type DavError,
	type InternalError,
} from "#src/domain/errors.ts";
import type { CollectionId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { BirthdayService } from "#src/services/birthday/service.ts";
import { CollectionService } from "#src/services/collection/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/collections/:collectionId/regenerate-birthdays
//
// On-demand force-refresh for the auto-managed Birthdays calendar — the
// scheduler sweep already reconciles it periodically (see
// src/services/birthday/scheduler.live.ts), this just lets the owner trigger
// the same reconcile immediately, e.g. right after editing a contact's BDAY.
// ---------------------------------------------------------------------------

export const collectionsRegenerateBirthdaysHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	collectionId: CollectionId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	BirthdayService | CollectionService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const collectionService = yield* CollectionService;
		const collection = yield* collectionService.findById(collectionId);

		if (
			collection.ownerPrincipalId !== principal.principalId ||
			collection.autoManagedKind !== "birthdays"
		) {
			return yield* Effect.fail(badRequest("not a birthdays collection"));
		}

		const birthdaySvc = yield* BirthdayService;
		yield* birthdaySvc.regenerate(principal.principalId, collectionId);

		const redirectTo = "/ui/calendar";
		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": redirectTo },
			});
		}
		return new Response(null, {
			status: 303,
			headers: { Location: redirectTo },
		});
	});
