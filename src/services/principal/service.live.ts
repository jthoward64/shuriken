import { Effect, Layer } from "effect";
import { someOrNotFound } from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { Email } from "#src/domain/types/strings.ts";
import {
	type PrincipalPropertyChanges,
	PrincipalRepository,
} from "./repository.ts";
import { PrincipalService } from "./service.ts";

// ---------------------------------------------------------------------------
// PrincipalService — live implementation
// ---------------------------------------------------------------------------

export const PrincipalServiceLive = Layer.effect(
	PrincipalService,
	Effect.gen(function* () {
		const repo = yield* PrincipalRepository;

		return PrincipalService.of({
			findById: Effect.fn("PrincipalService.findById")(function* (
				id: PrincipalId,
			) {
				yield* Effect.logTrace("principal.findById", { id });
				return yield* repo
					.findById(id)
					.pipe(Effect.flatMap(someOrNotFound(`Principal not found: ${id}`)));
			}),

			findBySlug: Effect.fn("PrincipalService.findBySlug")(function* (
				slug: Slug,
			) {
				yield* Effect.logTrace("principal.findBySlug", { slug });
				return yield* repo
					.findBySlug(slug)
					.pipe(Effect.flatMap(someOrNotFound(`Principal not found: ${slug}`)));
			}),

			findByEmail: Effect.fn("PrincipalService.findByEmail")(function* (
				email: Email,
			) {
				yield* Effect.logTrace("principal.findByEmail");
				return yield* repo
					.findByEmail(email)
					.pipe(
						Effect.flatMap(
							someOrNotFound(`Principal not found for email: ${email}`),
						),
					);
			}),

			updateProperties: Effect.fn("PrincipalService.updateProperties")(
				function* (id: PrincipalId, changes: PrincipalPropertyChanges) {
					yield* Effect.logTrace("principal.updateProperties", { id });
					return yield* repo.updateProperties(id, changes);
				},
			),
		});
	}),
);
