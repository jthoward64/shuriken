import { Effect, Layer } from "effect";
import { noneOrConflict, someOrNotFound } from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import { CollectionRepository, type NewCollection } from "./repository.ts";
import { CollectionService } from "./service.ts";

// ---------------------------------------------------------------------------
// CollectionService — live implementation
// ---------------------------------------------------------------------------

export const CollectionServiceLive = Layer.effect(
	CollectionService,
	Effect.gen(function* () {
		const repo = yield* CollectionRepository;

		return CollectionService.of({
			findById: Effect.fn("CollectionService.findById")(function* (
				id: CollectionId,
			) {
				yield* Effect.logTrace("collection.findById", { id });
				return yield* repo
					.findById(id)
					.pipe(Effect.flatMap(someOrNotFound(`Collection not found: ${id}`)));
			}),

			findBySlug: Effect.fn("CollectionService.findBySlug")(function* (
				ownerPrincipalId: PrincipalId,
				collectionType: string,
				slug: Slug,
			) {
				yield* Effect.logTrace("collection.findBySlug", {
					ownerPrincipalId,
					collectionType,
					slug,
				});
				return yield* repo
					.findBySlug(ownerPrincipalId, collectionType, slug)
					.pipe(
						Effect.flatMap(someOrNotFound(`Collection not found: ${slug}`)),
					);
			}),

			listByOwner: Effect.fn("CollectionService.listByOwner")(function* (
				ownerPrincipalId: PrincipalId,
			) {
				yield* Effect.logTrace("collection.listByOwner", { ownerPrincipalId });
				return yield* repo.listByOwner(ownerPrincipalId);
			}),

			create: Effect.fn("CollectionService.create")(function* (
				input: NewCollection,
			) {
				yield* Effect.logTrace("collection.create", {
					ownerPrincipalId: input.ownerPrincipalId,
					slug: input.slug,
					collectionType: input.collectionType,
				});
				return yield* repo.findBySlug(input.ownerPrincipalId, input.collectionType, input.slug).pipe(
					Effect.flatMap(
						noneOrConflict(
							undefined,
							`Collection already exists: ${input.slug}`,
						),
					),
					Effect.flatMap(() => repo.insert(input)),
				);
			}),

			delete: Effect.fn("CollectionService.delete")(function* (
				id: CollectionId,
			) {
				yield* Effect.logTrace("collection.delete", { id });
				return yield* repo.findById(id).pipe(
					Effect.flatMap(someOrNotFound(`Collection not found: ${id}`)),
					Effect.flatMap(() => repo.softDelete(id)),
				);
			}),
		});
	}),
);
