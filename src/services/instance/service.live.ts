import { Effect, Layer } from "effect";
import type { IrDeadProperties } from "#src/data/ir.ts";
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
				yield* Effect.annotateCurrentSpan({ "instance.id": id });
				yield* Effect.logTrace("instance.findById", { id });
				const result = yield* repo
					.findById(id)
					.pipe(Effect.flatMap(someOrNotFound(`Instance not found: ${id}`)));
				yield* Effect.logTrace("instance.findById result", {
					instanceId: result.id,
					slug: result.slug,
				});
				return result;
			}),

			findBySlug: Effect.fn("InstanceService.findBySlug")(function* (
				collectionId: CollectionId,
				slug: Slug,
			) {
				yield* Effect.annotateCurrentSpan({
					"instance.collection_id": collectionId,
					"instance.slug": slug,
				});
				yield* Effect.logTrace("instance.findBySlug", { collectionId, slug });
				const result = yield* repo
					.findBySlug(collectionId, slug)
					.pipe(Effect.flatMap(someOrNotFound(`Instance not found: ${slug}`)));
				yield* Effect.logTrace("instance.findBySlug result", {
					instanceId: result.id,
				});
				return result;
			}),

			listByCollection: Effect.fn("InstanceService.listByCollection")(
				function* (collectionId: CollectionId) {
					yield* Effect.annotateCurrentSpan({
						"instance.collection_id": collectionId,
					});
					yield* Effect.logTrace("instance.listByCollection", { collectionId });
					const results = yield* repo.listByCollection(collectionId);
					yield* Effect.logTrace("instance.listByCollection result", {
						count: results.length,
					});
					return results;
				},
			),

			put: Effect.fn("InstanceService.put")(function* (
				input: NewInstance,
				existingId?: InstanceId,
			) {
				yield* Effect.annotateCurrentSpan({
					"instance.collection_id": input.collectionId,
					"instance.slug": input.slug,
					"instance.existing_id": existingId ?? "",
				});
				yield* Effect.logTrace("instance.put", {
					collectionId: input.collectionId,
					existingId,
					slug: input.slug,
					isUpdate: existingId !== undefined,
				});
				if (existingId) {
					// Update existing instance etag (sync_revision is set by DB trigger)
					yield* repo.updateEtag(existingId, input.etag, input.contentLength);
					const result = yield* repo
						.findById(existingId)
						.pipe(
							Effect.flatMap(
								someOrNotFound(
									`Instance not found after update: ${existingId}`,
								),
							),
						);
					yield* Effect.logTrace("instance.put: updated", {
						instanceId: result.id,
					});
					return result;
				}
				const result = yield* repo.insert(input);
				yield* Effect.logDebug("instance.put: created", {
					instanceId: result.id,
					slug: result.slug,
				});
				return result;
			}),

			delete: Effect.fn("InstanceService.delete")(function* (id: InstanceId) {
				yield* Effect.annotateCurrentSpan({ "instance.id": id });
				yield* Effect.logTrace("instance.delete", { id });
				const result = yield* repo.findById(id).pipe(
					Effect.flatMap(someOrNotFound(`Instance not found: ${id}`)),
					Effect.flatMap(() => repo.softDelete(id)),
				);
				yield* Effect.logDebug("instance.delete: deleted", { id });
				return result;
			}),

			updateClientProperties: Effect.fn(
				"InstanceService.updateClientProperties",
			)(function* (id: InstanceId, clientProperties: IrDeadProperties) {
				yield* Effect.annotateCurrentSpan({ "instance.id": id });
				yield* Effect.logTrace("instance.updateClientProperties", { id });
				return yield* repo.updateClientProperties(id, clientProperties);
			}),
		});
	}),
);
