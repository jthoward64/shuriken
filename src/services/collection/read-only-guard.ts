import { Effect, Option } from "effect";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId } from "#src/domain/ids.ts";
import { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import { CollectionRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// Cross-cutting "is this collection writable by the client?" check.
//
// Two unrelated mechanisms make a collection read-only on the client side:
//
//   * external_calendar_claim — the subscription system owns the event set
//     and would overwrite any client PUT on the next sync.
//   * dav_collection.auto_managed_kind — server-derived calendars (e.g. the
//     birthdays calendar) are reconciled from another source of truth.
//
// Handlers care about the answer, not which mechanism triggered it. The two
// repo lookups run in parallel and short-circuit cheaply.
// ---------------------------------------------------------------------------

/** True iff `auto_managed_kind IS NOT NULL`. Used to block collection-level
 * mutations (DELETE, MOVE, RENAME) that would otherwise leave the server
 * generator without a target to reconcile into.
 */
export const isAutoManagedCollection = (
	id: CollectionId,
): Effect.Effect<boolean, DatabaseError, CollectionRepository> =>
	Effect.gen(function* () {
		const collRepo = yield* CollectionRepository;
		const opt = yield* collRepo.findById(id);
		return Option.isSome(opt) && opt.value.autoManagedKind !== null;
	});

export const isReadOnlyCollection = (
	id: CollectionId,
): Effect.Effect<
	boolean,
	DatabaseError,
	CollectionRepository | ExternalCalendarRepository
> =>
	Effect.gen(function* () {
		const collRepo = yield* CollectionRepository;
		const extRepo = yield* ExternalCalendarRepository;
		const [collOpt, claimOpt] = yield* Effect.all(
			[collRepo.findById(id), extRepo.findClaimByCollection(id)],
			{ concurrency: "unbounded" },
		);
		if (Option.isSome(claimOpt)) {
			return true;
		}
		if (Option.isSome(collOpt) && collOpt.value.autoManagedKind !== null) {
			return true;
		}
		return false;
	});
