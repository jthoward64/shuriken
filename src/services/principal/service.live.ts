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
				yield* Effect.annotateCurrentSpan({ "principal.id": id });
				yield* Effect.logTrace("principal.findById", { id });
				const result = yield* repo
					.findById(id)
					.pipe(Effect.flatMap(someOrNotFound(`Principal not found: ${id}`)));
				yield* Effect.logTrace("principal.findById result", {
					principalId: result.principal.id,
				});
				return result;
			}),

			findBySlug: Effect.fn("PrincipalService.findBySlug")(function* (
				slug: Slug,
			) {
				yield* Effect.annotateCurrentSpan({ "principal.slug": slug });
				yield* Effect.logTrace("principal.findBySlug", { slug });
				const result = yield* repo
					.findBySlug(slug)
					.pipe(Effect.flatMap(someOrNotFound(`Principal not found: ${slug}`)));
				yield* Effect.logTrace("principal.findBySlug result", {
					principalId: result.principal.id,
				});
				return result;
			}),

			findByEmail: Effect.fn("PrincipalService.findByEmail")(function* (
				email: Email,
			) {
				yield* Effect.logTrace("principal.findByEmail");
				const result = yield* repo
					.findByEmail(email)
					.pipe(
						Effect.flatMap(
							someOrNotFound(`Principal not found for email: ${email}`),
						),
					);
				yield* Effect.logTrace("principal.findByEmail result", {
					principalId: result.principal.id,
				});
				return result;
			}),

			updateProperties: Effect.fn("PrincipalService.updateProperties")(
				function* (id: PrincipalId, changes: PrincipalPropertyChanges) {
					yield* Effect.annotateCurrentSpan({ "principal.id": id });
					yield* Effect.logTrace("principal.updateProperties", { id });
					const result = yield* repo.updateProperties(id, changes);
					yield* Effect.logTrace("principal.updateProperties done", {
						principalId: result.id,
					});
					return result;
				},
			),
		});
	}),
);
