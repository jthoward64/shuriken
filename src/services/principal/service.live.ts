import { Effect, Layer } from "effect";
import { someOrNotFound } from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { Email } from "#src/domain/types/strings.ts";
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
				repo
					.findById(id)
					.pipe(Effect.flatMap(someOrNotFound(`Principal not found: ${id}`))),

			findBySlug: (slug: Slug) =>
				repo
					.findBySlug(slug)
					.pipe(Effect.flatMap(someOrNotFound(`Principal not found: ${slug}`))),

			findByEmail: (email: Email) =>
				repo
					.findByEmail(email)
					.pipe(
						Effect.flatMap(
							someOrNotFound(`Principal not found for email: ${email}`),
						),
					),
		});
	}),
);
