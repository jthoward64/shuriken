import { Data, Effect, Option } from "effect";
import type { DatabaseError } from "#src/domain/errors.ts";
import { CollectionId, type PrincipalId } from "#src/domain/ids.ts";
import { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import { CollectionRepository, type CollectionType } from "./repository.ts";
import {
	type CollectionSortKind,
	computeReorder,
	type SortableCollection,
} from "./sort-order.ts";

// ---------------------------------------------------------------------------
// Collection reorder use-case.
//
// Given the desired order of one principal's collections of a single kind and
// the id the user dragged, compute and persist the minimal set of sort_order
// changes. Collection "sort kind" (which drives the type-defaults) is derived
// the same way as read-only-guard: auto_managed_kind => generated, an external
// subscription claim => subscribed, otherwise normal.
// ---------------------------------------------------------------------------

/** The desired order didn't match the principal's active collections of the
 * requested type (unknown id, missing id, duplicate, or wrong owner). */
export class InvalidReorder extends Data.TaggedError("InvalidReorder")<{
	readonly message: string;
}> {}

export interface ReorderParams {
	readonly ownerPrincipalId: PrincipalId;
	readonly collectionType: CollectionType;
	/** Full desired top-to-bottom order (a permutation of the owner's active
	 * collections of `collectionType`). */
	readonly desiredIds: ReadonlyArray<CollectionId>;
	/** The single collection the user dragged. Must be present in desiredIds. */
	readonly movedId: CollectionId;
}

export const reorderCollections = (
	params: ReorderParams,
): Effect.Effect<
	ReadonlyMap<CollectionId, number>,
	DatabaseError | InvalidReorder,
	CollectionRepository | ExternalCalendarRepository
> =>
	Effect.gen(function* () {
		const collRepo = yield* CollectionRepository;
		const extRepo = yield* ExternalCalendarRepository;

		const rows = (yield* collRepo.listByOwner(params.ownerPrincipalId)).filter(
			(c) => c.collectionType === params.collectionType,
		);
		const byId = new Map(rows.map((r) => [r.id, r] as const));

		// The desired list must be an exact permutation of the owner's active
		// collections of this kind — no unknowns, no omissions, no duplicates.
		const desiredSet = new Set<string>(params.desiredIds);
		const isPermutation =
			params.desiredIds.length === rows.length &&
			desiredSet.size === rows.length &&
			params.desiredIds.every((id) => byId.has(id));
		if (!isPermutation || !byId.has(params.movedId)) {
			return yield* Effect.fail(
				new InvalidReorder({
					message:
						"desired order must be a permutation of the owner's collections of this type",
				}),
			);
		}

		// Classify each collection so the algorithm knows its type-default.
		const kindEntries = yield* Effect.all(
			rows.map((r) =>
				Effect.gen(function* () {
					const kind: CollectionSortKind =
						r.autoManagedKind !== null
							? "generated"
							: Option.isSome(
										yield* extRepo.findClaimByCollection(CollectionId(r.id)),
									)
								? "subscribed"
								: "normal";
					return [r.id, kind] as const;
				}),
			),
			{ concurrency: "unbounded" },
		);
		const kindOf = new Map<string, CollectionSortKind>(kindEntries);

		const desired: ReadonlyArray<SortableCollection> = params.desiredIds.map(
			(id) => {
				const row = byId.get(id);
				return {
					id,
					kind: kindOf.get(id) ?? "normal",
					sortOrder: row?.sortOrder ?? 0,
				};
			},
		);

		const changes = computeReorder(desired, params.movedId);
		// Re-key from the already-branded desiredIds so we don't re-parse strings.
		const mapped = new Map<CollectionId, number>();
		for (const id of params.desiredIds) {
			const value = changes.get(id);
			if (value !== undefined) {
				mapped.set(id, value);
			}
		}
		yield* collRepo.reorder(mapped);
		return mapped;
	});
