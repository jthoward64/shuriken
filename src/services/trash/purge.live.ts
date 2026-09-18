import { Duration, Effect, Layer, Schedule } from "effect";
import { Temporal } from "temporal-polyfill";
import { AppConfigService } from "#src/config.ts";
import { CollectionId, InstanceId } from "#src/domain/ids.ts";
import {
	CollectionRepository,
	type CollectionRepositoryShape,
} from "#src/services/collection/repository.ts";
import {
	InstanceRepository,
	type InstanceRepositoryShape,
} from "#src/services/instance/repository.ts";

// ---------------------------------------------------------------------------
// TrashPurgeLayer — periodic sweep that hard-deletes soft-deleted collections
// and instances once they've aged past `trash.retentionDays`.
//
// When retentionDays is 0, deletes are already immediate hard-deletes at the
// UI edge (see collections/delete.ts, contacts/delete.ts) — there is never
// anything left in the trash to sweep, so this layer is a no-op in that mode.
//
// Collections are purged first: CollectionRepository.hardDelete removes every
// instance under the collection too (dav_instance.collection_id is ON DELETE
// RESTRICT), so any instance belonging to an about-to-be-purged collection is
// removed as a side effect. The instance sweep that follows only picks up
// instances that were individually soft-deleted under a still-active
// collection — anything already removed by the collection purge is simply
// absent from that second query.
// ---------------------------------------------------------------------------

const PURGE_INTERVAL_DAYS = 1;
const HOURS_PER_DAY = 24;

/** One purge tick: hard-delete every collection and instance past its retention. */
const sweepOnce = Effect.fn("scheduler.trash-purge.tick")(function* (
	repos: {
		readonly collectionRepo: CollectionRepositoryShape;
		readonly instanceRepo: InstanceRepositoryShape;
	},
	retentionDays: number,
) {
	const cutoff = Temporal.Now.instant().subtract(
		Temporal.Duration.from({ hours: retentionDays * HOURS_PER_DAY }),
	);

	const expiredCollections =
		yield* repos.collectionRepo.listDeletedOlderThan(cutoff);
	yield* Effect.forEach(
		expiredCollections,
		(c) => repos.collectionRepo.hardDelete(CollectionId(c.id)),
		{ discard: true },
	);

	const expiredInstances =
		yield* repos.instanceRepo.listDeletedOlderThan(cutoff);
	yield* Effect.forEach(
		expiredInstances,
		(i) => repos.instanceRepo.hardDelete(InstanceId(i.id)),
		{ discard: true },
	);

	yield* Effect.logInfo("scheduler.trash-purge: sweep complete", {
		purgedCollections: expiredCollections.length,
		purgedInstances: expiredInstances.length,
	});
});

/** Forks the purge sweep on the configured interval, logging and continuing past a crash. */
const startPurgeFiber = Effect.fn("scheduler.trash-purge.start")(function* (
	retentionDays: number,
) {
	const collectionRepo = yield* CollectionRepository;
	const instanceRepo = yield* InstanceRepository;

	yield* Effect.logInfo("scheduler.trash-purge: starting sweep fiber", {
		retentionDays,
		intervalDays: PURGE_INTERVAL_DAYS,
	});
	yield* sweepOnce({ collectionRepo, instanceRepo }, retentionDays).pipe(
		Effect.catchCause((cause) =>
			Effect.logWarning("scheduler.trash-purge: tick failed", { cause }),
		),
		Effect.repeat(Schedule.spaced(Duration.days(PURGE_INTERVAL_DAYS))),
		Effect.forkScoped,
	);
});

export const TrashPurgeLayer = Layer.unwrap(
	Effect.gen(function* () {
		const { trash } = yield* AppConfigService;
		// Retention of 0 disables the purge entirely
		return trash.retentionDays === 0
			? Layer.empty
			: Layer.effectDiscard(startPurgeFiber(trash.retentionDays));
	}),
);
