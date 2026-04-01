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
			findById: (id: InstanceId) =>
				repo.findById(id).pipe(
					Effect.flatMap(someOrNotFound(`Instance not found: ${id}`)),
				),

			findBySlug: (collectionId: CollectionId, slug: Slug) =>
				repo.findBySlug(collectionId, slug).pipe(
					Effect.flatMap(someOrNotFound(`Instance not found: ${slug}`)),
				),

			listByCollection: (collectionId: CollectionId) =>
				repo.listByCollection(collectionId),

			put: (input: NewInstance, existingId?: InstanceId) =>
				Effect.gen(function* () {
					if (existingId) {
						// Update existing instance etag + revision
						const existing = yield* repo.findById(existingId).pipe(
							Effect.flatMap(someOrNotFound(`Instance not found: ${existingId}`)),
						);
						const newRevision = existing.syncRevision + 1;
						yield* repo.updateEtag(existingId, input.etag, newRevision);
						return yield* repo.findById(existingId).pipe(
							Effect.flatMap(
								someOrNotFound(`Instance not found after update: ${existingId}`),
							),
						);
					}
					return yield* repo.insert(input);
				}),

			delete: (id: InstanceId) =>
				repo.findById(id).pipe(
					Effect.flatMap(someOrNotFound(`Instance not found: ${id}`)),
					Effect.flatMap(() => repo.softDelete(id)),
				),
		});
	}),
);
