import { Duration, Effect, Layer, Schedule } from "effect";
import { Temporal } from "temporal-polyfill";
import { AppConfigService } from "#src/config.ts";
import { CollectionId, InstanceId } from "#src/domain/ids.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";

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

export const TrashPurgeLayer = Layer.unwrap(
	Effect.gen(function* () {
		const { trash } = yield* AppConfigService;

		if (trash.retentionDays === 0) {
			return Layer.empty;
		}

		return Layer.effectDiscard(
			Effect.gen(function* () {
				const collectionRepo = yield* CollectionRepository;
				const instanceRepo = yield* InstanceRepository;

				const sweep = Effect.gen(function* () {
					const cutoff = Temporal.Now.instant().subtract(
						Temporal.Duration.from({ hours: trash.retentionDays * 24 }),
					);

					const expiredCollections =
						yield* collectionRepo.listDeletedOlderThan(cutoff);
					yield* Effect.forEach(
						expiredCollections,
						(c) => collectionRepo.hardDelete(CollectionId(c.id)),
						{ discard: true },
					);

					const expiredInstances =
						yield* instanceRepo.listDeletedOlderThan(cutoff);
					yield* Effect.forEach(
						expiredInstances,
						(i) => instanceRepo.hardDelete(InstanceId(i.id)),
						{ discard: true },
					);

					yield* Effect.logInfo("scheduler.trash-purge: sweep complete", {
						purgedCollections: expiredCollections.length,
						purgedInstances: expiredInstances.length,
					});
				});

				yield* Effect.logInfo("scheduler.trash-purge: starting sweep fiber", {
					retentionDays: trash.retentionDays,
					intervalDays: PURGE_INTERVAL_DAYS,
				});
				yield* sweep.pipe(
					Effect.catchCause((cause) =>
						Effect.logWarning("scheduler.trash-purge: tick failed", { cause }),
					),
					Effect.repeat(Schedule.spaced(Duration.days(PURGE_INTERVAL_DAYS))),
					Effect.forkScoped,
				);
			}),
		);
	}),
);
