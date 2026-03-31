import { Effect, Layer } from "effect";
import { conflict, notFound } from "#/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#/domain/ids.ts";
import type { Slug } from "#/domain/types/path.ts";
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
				Effect.gen(function* () {
					const row = yield* repo.findById(id);
					if (row) { return row; }
					return yield* Effect.fail(notFound(`Collection not found: ${id}`));
				}),

			findBySlug: (ownerPrincipalId: PrincipalId, slug: Slug) =>
				Effect.gen(function* () {
					const row = yield* repo.findBySlug(ownerPrincipalId, slug);
					if (row) { return row; }
					return yield* Effect.fail(notFound(`Collection not found: ${slug}`));
				}),

			listByOwner: (ownerPrincipalId: PrincipalId) =>
				repo.listByOwner(ownerPrincipalId),

			create: (input: NewCollection) =>
				Effect.gen(function* () {
					const existing = yield* repo.findBySlug(
						input.ownerPrincipalId,
						input.slug,
					);
					if (existing) {
						return yield* Effect.fail(
							conflict(undefined, `Collection already exists: ${input.slug}`),
						);
					}
					return yield* repo.insert(input);
				}),

			delete: (id: CollectionId) =>
				Effect.gen(function* () {
					const existing = yield* repo.findById(id);
					if (!existing) {
						return yield* Effect.fail(notFound(`Collection not found: ${id}`));
					}
					yield* repo.softDelete(id);
				}),
		});
	}),
);
