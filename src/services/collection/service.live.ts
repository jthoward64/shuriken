import { Effect, Layer } from "effect";
import { noneOrConflict, someOrNotFound } from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import { AclRepository } from "#src/services/acl/repository.ts";
import {
	type CollectionPropertyChanges,
	CollectionRepository,
	type CollectionType,
	type NewCollection,
} from "./repository.ts";
import { CollectionService } from "./service.ts";

// ---------------------------------------------------------------------------
// CollectionService — live implementation
// ---------------------------------------------------------------------------

export const CollectionServiceLive = Layer.effect(
	CollectionService,
	Effect.gen(function* () {
		const repo = yield* CollectionRepository;
		const aclRepo = yield* AclRepository;

		return CollectionService.of({
			findById: Effect.fn("CollectionService.findById")(function* (
				id: CollectionId,
			) {
				yield* Effect.annotateCurrentSpan({ "collection.id": id });
				yield* Effect.logTrace("collection.findById", { id });
				const result = yield* repo
					.findById(id)
					.pipe(Effect.flatMap(someOrNotFound(`Collection not found: ${id}`)));
				yield* Effect.logTrace("collection.findById result", {
					collectionId: result.id,
					type: result.collectionType,
				});
				return result;
			}),

			findBySlug: Effect.fn("CollectionService.findBySlug")(function* (
				ownerPrincipalId: PrincipalId,
				collectionType: CollectionType,
				slug: Slug,
			) {
				yield* Effect.annotateCurrentSpan({
					"collection.owner": ownerPrincipalId,
					"collection.type": collectionType,
					"collection.slug": slug,
				});
				yield* Effect.logTrace("collection.findBySlug", {
					ownerPrincipalId,
					collectionType,
					slug,
				});
				const result = yield* repo
					.findBySlug(ownerPrincipalId, collectionType, slug)
					.pipe(
						Effect.flatMap(someOrNotFound(`Collection not found: ${slug}`)),
					);
				yield* Effect.logTrace("collection.findBySlug result", {
					collectionId: result.id,
				});
				return result;
			}),

			listByOwner: Effect.fn("CollectionService.listByOwner")(function* (
				ownerPrincipalId: PrincipalId,
			) {
				yield* Effect.annotateCurrentSpan({
					"collection.owner": ownerPrincipalId,
				});
				yield* Effect.logTrace("collection.listByOwner", { ownerPrincipalId });
				const results = yield* repo.listByOwner(ownerPrincipalId);
				yield* Effect.logTrace("collection.listByOwner result", {
					count: results.length,
				});
				return results;
			}),

			create: Effect.fn("CollectionService.create")(function* (
				input: NewCollection,
			) {
				yield* Effect.annotateCurrentSpan({
					"collection.owner": input.ownerPrincipalId,
					"collection.type": input.collectionType,
					"collection.slug": input.slug,
				});
				yield* Effect.logTrace("collection.create", {
					ownerPrincipalId: input.ownerPrincipalId,
					slug: input.slug,
					collectionType: input.collectionType,
				});
				yield* repo
					.findBySlug(input.ownerPrincipalId, input.collectionType, input.slug)
					.pipe(
						Effect.flatMap(
							noneOrConflict(
								undefined,
								`Collection already exists: ${input.slug}`,
							),
						),
					);
				const collection = yield* repo.insert(input);
				yield* aclRepo.grantAce({
					resourceType: "collection",
					resourceId: collection.id,
					principalType: "principal",
					principalId: input.ownerPrincipalId,
					privilege: "DAV:all",
					grantDeny: "grant",
					protected: true,
					ordinal: 0,
				});
				yield* Effect.logDebug("collection.create: created", {
					collectionId: collection.id,
					type: collection.collectionType,
				});
				return collection;
			}),

			delete: Effect.fn("CollectionService.delete")(function* (
				id: CollectionId,
			) {
				yield* Effect.annotateCurrentSpan({ "collection.id": id });
				yield* Effect.logTrace("collection.delete", { id });
				const result = yield* repo.findById(id).pipe(
					Effect.flatMap(someOrNotFound(`Collection not found: ${id}`)),
					Effect.flatMap(() => repo.softDelete(id)),
				);
				yield* Effect.logDebug("collection.delete: deleted", { id });
				return result;
			}),

			updateProperties: Effect.fn("CollectionService.updateProperties")(
				function* (id: CollectionId, changes: CollectionPropertyChanges) {
					yield* Effect.annotateCurrentSpan({ "collection.id": id });
					yield* Effect.logTrace("collection.updateProperties", { id });
					return yield* repo.updateProperties(id, changes);
				},
			),
		});
	}),
);
