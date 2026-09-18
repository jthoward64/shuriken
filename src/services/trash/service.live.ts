import { Effect, Layer, Option } from "effect";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, InstanceId, PrincipalId } from "#src/domain/ids.ts";
import {
	CollectionRepository,
	type CollectionRepositoryShape,
	type CollectionRow,
} from "#src/services/collection/repository.ts";
import {
	InstanceRepository,
	type InstanceRepositoryShape,
} from "#src/services/instance/repository.ts";
import { TrashNotFound, TrashNotOwner } from "./error.ts";
import { TrashService } from "./service.ts";

// ---------------------------------------------------------------------------
// TrashService — live implementation
// ---------------------------------------------------------------------------

// Resolve a collection by id whether it's currently active or soft-deleted —
// findById alone can't see soft-deleted rows, but an instance's parent
// collection may or may not be deleted itself.
const findCollectionAnyStatus = Effect.fn("TrashService.findCollection")(
	function* (
		collectionRepo: CollectionRepositoryShape,
		id: CollectionId,
	): Generator<
		Effect.Effect<unknown, DatabaseError>,
		Option.Option<CollectionRow>
	> {
		const active = yield* collectionRepo.findById(id);
		return Option.isSome(active)
			? active
			: yield* collectionRepo.findDeletedById(id);
	},
);

/** The soft-deleted collection, failing unless the caller owns it. */
const requireOwnedDeletedCollection = Effect.fn(
	"TrashService.requireOwnedCollection",
)(function* (
	collectionRepo: CollectionRepositoryShape,
	id: CollectionId,
	callerPrincipalId: PrincipalId,
) {
	const opt = yield* collectionRepo.findDeletedById(id);
	if (Option.isNone(opt)) {
		return yield* Effect.fail(
			new TrashNotFound({ resourceType: "collection", id }),
		);
	}
	if (opt.value.ownerPrincipalId !== callerPrincipalId) {
		return yield* Effect.fail(
			new TrashNotOwner({ resourceType: "collection", id }),
		);
	}
	return opt.value;
});

/** The soft-deleted instance, failing unless the caller owns its collection. */
const requireOwnedDeletedInstance = Effect.fn(
	"TrashService.requireOwnedInstance",
)(function* (
	repos: {
		readonly collectionRepo: CollectionRepositoryShape;
		readonly instanceRepo: InstanceRepositoryShape;
	},
	id: InstanceId,
	callerPrincipalId: PrincipalId,
) {
	const instanceOpt = yield* repos.instanceRepo.findDeletedById(id);
	if (Option.isNone(instanceOpt)) {
		return yield* Effect.fail(
			new TrashNotFound({ resourceType: "instance", id }),
		);
	}
	const instance = instanceOpt.value;
	const collectionOpt = yield* findCollectionAnyStatus(
		repos.collectionRepo,
		instance.collectionId as CollectionId,
	);
	if (Option.isNone(collectionOpt)) {
		return yield* Effect.fail(
			new TrashNotFound({ resourceType: "instance", id }),
		);
	}
	if (collectionOpt.value.ownerPrincipalId !== callerPrincipalId) {
		return yield* Effect.fail(
			new TrashNotOwner({ resourceType: "instance", id }),
		);
	}
	return instance;
});

export const TrashServiceLive = Layer.effect(
	TrashService,
	Effect.gen(function* () {
		const collectionRepo = yield* CollectionRepository;
		const instanceRepo = yield* InstanceRepository;

		return {
			listTrash: Effect.fn("TrashService.listTrash")(function* (
				ownerPrincipalId: PrincipalId,
			) {
				yield* Effect.annotateCurrentSpan({
					"principal.id": ownerPrincipalId,
				});
				yield* Effect.logTrace("trash.listTrash", { ownerPrincipalId });
				const [deletedCollections, activeCollections] = yield* Effect.all([
					collectionRepo.listDeletedByOwner(ownerPrincipalId),
					collectionRepo.listByOwner(ownerPrincipalId),
				]);
				const ownedCollectionIds = [
					...deletedCollections,
					...activeCollections,
				].map((c) => c.id as CollectionId);
				const deletedInstancesByCollection = yield* Effect.forEach(
					ownedCollectionIds,
					(id) => instanceRepo.listDeletedByCollection(id),
					{ concurrency: "unbounded" },
				);
				return {
					collections: deletedCollections,
					instances: deletedInstancesByCollection.flat(),
				};
			}),

			restoreCollection: Effect.fn("TrashService.restoreCollection")(function* (
				id: CollectionId,
				callerPrincipalId: PrincipalId,
			) {
				yield* Effect.annotateCurrentSpan({ "collection.id": id });
				yield* requireOwnedDeletedCollection(
					collectionRepo,
					id,
					callerPrincipalId,
				);
				const result = yield* collectionRepo.restore(id);
				yield* Effect.logDebug("trash.restoreCollection: restored", { id });
				return result;
			}),

			restoreInstance: Effect.fn("TrashService.restoreInstance")(function* (
				id: InstanceId,
				callerPrincipalId: PrincipalId,
			) {
				yield* Effect.annotateCurrentSpan({ "instance.id": id });
				yield* requireOwnedDeletedInstance(
					{ collectionRepo, instanceRepo },
					id,
					callerPrincipalId,
				);
				const result = yield* instanceRepo.restore(id);
				yield* Effect.logDebug("trash.restoreInstance: restored", { id });
				return result;
			}),

			purgeCollectionForever: Effect.fn("TrashService.purgeCollectionForever")(
				function* (id: CollectionId, callerPrincipalId: PrincipalId) {
					yield* Effect.annotateCurrentSpan({ "collection.id": id });
					yield* requireOwnedDeletedCollection(
						collectionRepo,
						id,
						callerPrincipalId,
					);
					yield* collectionRepo.hardDelete(id);
					yield* Effect.logDebug("trash.purgeCollectionForever: purged", {
						id,
					});
				},
			),

			purgeInstanceForever: Effect.fn("TrashService.purgeInstanceForever")(
				function* (id: InstanceId, callerPrincipalId: PrincipalId) {
					yield* Effect.annotateCurrentSpan({ "instance.id": id });
					yield* requireOwnedDeletedInstance(
						{ collectionRepo, instanceRepo },
						id,
						callerPrincipalId,
					);
					yield* instanceRepo.hardDelete(id);
					yield* Effect.logDebug("trash.purgeInstanceForever: purged", { id });
				},
			),
		};
	}),
);
