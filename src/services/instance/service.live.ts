import { Effect, Layer } from "effect";
import { someOrNotFound } from "#src/domain/errors.ts";
import type { CollectionId, InstanceId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import { InstanceRepository, type NewInstance } from "./repository.ts";
import { InstanceService } from "./service.ts";

// ---------------------------------------------------------------------------
// InstanceService — live implementation
// ---------------------------------------------------------------------------

export const InstanceServiceLive = Layer.effect(
	InstanceService,
	Effect.gen(function* () {
		const repo = yield* InstanceRepository;

		return InstanceService.of({
			findById: Effect.fn("InstanceService.findById")(function* (
				id: InstanceId,
			) {
				yield* Effect.logTrace("instance.findById", { id });
				return yield* repo
					.findById(id)
					.pipe(Effect.flatMap(someOrNotFound(`Instance not found: ${id}`)));
			}),

			findBySlug: Effect.fn("InstanceService.findBySlug")(function* (
				collectionId: CollectionId,
				slug: Slug,
			) {
				yield* Effect.logTrace("instance.findBySlug", { collectionId, slug });
				return yield* repo
					.findBySlug(collectionId, slug)
					.pipe(Effect.flatMap(someOrNotFound(`Instance not found: ${slug}`)));
			}),

			listByCollection: Effect.fn("InstanceService.listByCollection")(
				function* (collectionId: CollectionId) {
					yield* Effect.logTrace("instance.listByCollection", { collectionId });
					return yield* repo.listByCollection(collectionId);
				},
			),

			put: Effect.fn("InstanceService.put")(function* (
				input: NewInstance,
				existingId?: InstanceId,
			) {
				yield* Effect.logTrace("instance.put", {
					collectionId: input.collectionId,
					existingId,
				});
				if (existingId) {
					// Update existing instance etag + revision
					const existing = yield* repo
						.findById(existingId)
						.pipe(
							Effect.flatMap(
								someOrNotFound(`Instance not found: ${existingId}`),
							),
						);
					const newRevision = existing.syncRevision + 1;
					yield* repo.updateEtag(existingId, input.etag, newRevision);
					return yield* repo
						.findById(existingId)
						.pipe(
							Effect.flatMap(
								someOrNotFound(`Instance not found after update: ${existingId}`),
							),
						);
				}
				return yield* repo.insert(input);
			}),

			delete: Effect.fn("InstanceService.delete")(function* (id: InstanceId) {
				yield* Effect.logTrace("instance.delete", { id });
				return yield* repo.findById(id).pipe(
					Effect.flatMap(someOrNotFound(`Instance not found: ${id}`)),
					Effect.flatMap(() => repo.softDelete(id)),
				);
			}),
		});
	}),
);
