import type { Effect } from "effect";
import { Context } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { EntityId, InstanceId } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// ContactMergeService — collapse a set of duplicate vCards into one.
//
// The primary card (auto-picked as the most complete) is kept and enriched with
// the unique multi-valued fields of the others; the others are then deleted
// (soft-deleted, so sync clients see tombstones). Operates on the vCard IR so
// no field is lost — see merge-vcard.ts.
//
// Authorisation is NOT enforced here — UI handlers run AclService.check against
// every involved collection before invoking merge (mirrors CardEditService).
// ---------------------------------------------------------------------------

export interface ContactMergeResult {
	/** The surviving instance (the primary that was enriched in place). */
	readonly primaryInstanceId: InstanceId;
	readonly primaryEntityId: EntityId;
	/** FN of the merged card, for user-facing confirmation. */
	readonly fn: string | null;
	/** How many duplicate cards were merged in and removed. */
	readonly mergedCount: number;
}

export interface ContactMergeServiceShape {
	/**
	 * Merge two or more contacts identified by instance id into one. Fails with a
	 * 400 DavError if fewer than two ids are supplied.
	 */
	readonly merge: (
		instanceIds: ReadonlyArray<InstanceId>,
	) => Effect.Effect<
		ContactMergeResult,
		DatabaseError | DavError | InternalError
	>;
}

export class ContactMergeService extends Context.Service<
	ContactMergeService,
	ContactMergeServiceShape
>()("ContactMergeService") {}
