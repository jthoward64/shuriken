import { Effect, Layer } from "effect";
import { notFound } from "#/domain/errors.ts";
import type { CollectionId, InstanceId } from "#/domain/ids.ts";
import type { Slug } from "#/domain/types/path.ts";
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
				Effect.gen(function* () {
					const row = yield* repo.findById(id);
					if (row) { return row; }
					return yield* Effect.fail(notFound(`Instance not found: ${id}`));
				}),

			findBySlug: (collectionId: CollectionId, slug: Slug) =>
				Effect.gen(function* () {
					const row = yield* repo.findBySlug(collectionId, slug);
					if (row) { return row; }
					return yield* Effect.fail(notFound(`Instance not found: ${slug}`));
				}),

			listByCollection: (collectionId: CollectionId) =>
				repo.listByCollection(collectionId),

			put: (input: NewInstance, existingId?: InstanceId) =>
				Effect.gen(function* () {
					if (existingId) {
						// Update existing instance etag + revision
						const existing = yield* repo.findById(existingId);
						if (!existing) {
							return yield* Effect.fail(
								notFound(`Instance not found: ${existingId}`),
							);
						}
						const newRevision = existing.syncRevision + 1;
						yield* repo.updateEtag(existingId, input.etag, newRevision);
						const updated = yield* repo.findById(existingId);
						if (!updated) {
							return yield* Effect.fail(
								notFound(`Instance not found after update: ${existingId}`),
							);
						}
						return updated;
					}
					return yield* repo.insert(input);
				}),

			delete: (id: InstanceId) =>
				Effect.gen(function* () {
					const existing = yield* repo.findById(id);
					if (!existing) {
						return yield* Effect.fail(notFound(`Instance not found: ${id}`));
					}
					yield* repo.softDelete(id);
				}),
		});
	}),
);
