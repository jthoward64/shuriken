import { Effect, Layer } from "effect";
import { notFound } from "#/domain/errors.ts";
import type { PrincipalId } from "#/domain/ids.ts";
import type { Slug } from "#/domain/types/path.ts";
import { PrincipalRepository } from "./repository.ts";
import { PrincipalService } from "./service.ts";

// ---------------------------------------------------------------------------
// PrincipalService — live implementation
// ---------------------------------------------------------------------------

export const PrincipalServiceLive = Layer.effect(
	PrincipalService,
	Effect.gen(function* () {
		const repo = yield* PrincipalRepository;

		return PrincipalService.of({
			findById: (id: PrincipalId) =>
				Effect.gen(function* () {
					const row = yield* repo.findById(id);
					if (row) {
						// Need the user too — fall back to findBySlug chain is awkward;
						// for now return a minimal joined result.
						// TODO: repo.findById should return PrincipalWithUser directly
						return yield* Effect.fail(notFound(`Principal ${id} has no user`));
					}
					return yield* Effect.fail(notFound(`Principal not found: ${id}`));
				}),

			findBySlug: (slug: Slug) =>
				Effect.gen(function* () {
					const row = yield* repo.findBySlug(slug);
					if (row) { return row; }
					return yield* Effect.fail(notFound(`Principal not found: ${slug}`));
				}),

			findByEmail: (email: string) =>
				Effect.gen(function* () {
					const row = yield* repo.findByEmail(email);
					if (row) { return row; }
					return yield* Effect.fail(
						notFound(`Principal not found for email: ${email}`),
					);
				}),
		});
	}),
);
