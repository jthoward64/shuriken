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
				yield* Effect.logTrace("collection.findById", { id });
				return yield* repo
					.findById(id)
					.pipe(Effect.flatMap(someOrNotFound(`Collection not found: ${id}`)));
			}),

			findBySlug: Effect.fn("CollectionService.findBySlug")(function* (
				ownerPrincipalId: PrincipalId,
				collectionType: CollectionType,
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
				return collection;
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

			updateProperties: Effect.fn("CollectionService.updateProperties")(
				function* (id: CollectionId, changes: CollectionPropertyChanges) {
					yield* Effect.logTrace("collection.updateProperties", { id });
					return yield* repo.updateProperties(id, changes);
				},
			),
		});
	}),
);
