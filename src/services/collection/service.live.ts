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
			findById: (id: CollectionId) =>
				repo.findById(id).pipe(
					Effect.flatMap(someOrNotFound(`Collection not found: ${id}`)),
				),

			findBySlug: (ownerPrincipalId: PrincipalId, slug: Slug) =>
				repo.findBySlug(ownerPrincipalId, slug).pipe(
					Effect.flatMap(someOrNotFound(`Collection not found: ${slug}`)),
				),

			listByOwner: (ownerPrincipalId: PrincipalId) =>
				repo.listByOwner(ownerPrincipalId),

			create: (input: NewCollection) =>
				repo.findBySlug(input.ownerPrincipalId, input.slug).pipe(
					Effect.flatMap(
						noneOrConflict(
							undefined,
							`Collection already exists: ${input.slug}`,
						),
					),
					Effect.flatMap(() => repo.insert(input)),
				),

			delete: (id: CollectionId) =>
				repo.findById(id).pipe(
					Effect.flatMap(someOrNotFound(`Collection not found: ${id}`)),
					Effect.flatMap(() => repo.softDelete(id)),
				),
		});
	}),
);
