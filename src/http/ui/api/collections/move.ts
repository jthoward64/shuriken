import { Effect } from "effect";
import {
	badRequest,
	type DatabaseError,
	type DavError,
} from "#src/domain/errors.ts";
import { CollectionId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_OK, HTTP_SEE_OTHER } from "#src/http/status.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import {
	type InvalidReorder,
	reorderCollections,
} from "#src/services/collection/reorder.ts";
import type { CollectionRepository } from "#src/services/collection/repository.ts";
import type { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/collections/:collectionId/move/:direction
//
// No-JS fallback for reordering: a plain form submit that swaps the target
// collection with its immediate neighbour in the current (sortOrder, id)
// order. The JS drag-and-drop UI hides these buttons (`data-nojs-only`) and
// talks to the richer /ui/api/collections/reorder endpoint instead, but both
// paths funnel into the same `reorderCollections` use-case.
// ---------------------------------------------------------------------------

const destinationFor = (
	collectionType: string,
	collectionId: string,
): string =>
	collectionType === "addressbook"
		? `/ui/contacts?addressbook=${collectionId}`
		: `/ui/calendar?collection=${collectionId}`;

export const collectionsMoveHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	collectionId: CollectionId,
	direction: "up" | "down",
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	CollectionService | CollectionRepository | ExternalCalendarRepository
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const collectionService = yield* CollectionService;

		const target = yield* collectionService.findById(collectionId);
		if (target.ownerPrincipalId !== principal.principalId) {
			return yield* Effect.fail(badRequest("not this principal's collection"));
		}

		const rows = (yield* collectionService.listByOwner(
			principal.principalId,
		)).filter((c) => c.collectionType === target.collectionType);
		const idx = rows.findIndex((r) => r.id === collectionId);
		const swapWith = direction === "up" ? idx - 1 : idx + 1;

		if (idx >= 0 && swapWith >= 0 && swapWith < rows.length) {
			const desiredIds = rows.map((r) => CollectionId(r.id));
			const tmp = desiredIds[idx];
			desiredIds[idx] = desiredIds[swapWith] as CollectionId;
			desiredIds[swapWith] = tmp as CollectionId;

			yield* reorderCollections({
				ownerPrincipalId: principal.principalId,
				collectionType: target.collectionType,
				desiredIds,
				movedId: collectionId,
			}).pipe(
				Effect.catchTag("InvalidReorder", (e: InvalidReorder) =>
					Effect.fail(badRequest(e.message)),
				),
			);
		}

		const destination = destinationFor(target.collectionType, collectionId);
		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: HTTP_OK,
				headers: { "HX-Redirect": destination },
			});
		}
		return new Response(null, {
			status: HTTP_SEE_OTHER,
			headers: { Location: destination },
		});
	});
