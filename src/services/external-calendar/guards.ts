import { Effect, Option } from "effect";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId } from "#src/domain/ids.ts";
import { ExternalCalendarRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// Subscription guards — small predicates that answer "is this collection
// owned by an external feed?" so the HTTP handlers can reject mutations
// without each one re-implementing the repo lookup.
// ---------------------------------------------------------------------------

/**
 * `true` when there is an `external_calendar_claim` pointing at this
 * collection. Subscribed collections are read-only for their members; the
 * collection's metadata (displayname, color) stays user-editable.
 */
export const isSubscribedCollection = (
	id: CollectionId,
): Effect.Effect<boolean, DatabaseError, ExternalCalendarRepository> =>
	Effect.gen(function* () {
		const repo = yield* ExternalCalendarRepository;
		const claim = yield* repo.findClaimByCollection(id);
		return Option.isSome(claim);
	});
