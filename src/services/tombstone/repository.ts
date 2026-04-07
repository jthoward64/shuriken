import type { InferSelectModel } from "drizzle-orm";
import type { Effect } from "effect";
import { Context } from "effect";
import type { davTombstone } from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// TombstoneRepository — data access for dav_tombstone rows
//
// Tombstones are created automatically by the sync_token_on_instance_change
// trigger when a dav_instance row is soft-deleted. They support RFC 6578
// DAV:sync-collection delta sync so clients can discover removed resources.
// ---------------------------------------------------------------------------

export type TombstoneRow = InferSelectModel<typeof davTombstone>;

export interface TombstoneRepositoryShape {
	/**
	 * Return all tombstones for a collection whose sync_revision is strictly
	 * greater than `sinceSyncRevision`, ordered by sync_revision ascending.
	 *
	 * Used by the sync-collection REPORT handler to return deleted resources
	 * in the delta window (initialRevision, currentSynctoken].
	 */
	readonly findSinceRevision: (
		collectionId: CollectionId,
		sinceSyncRevision: number,
	) => Effect.Effect<ReadonlyArray<TombstoneRow>, DatabaseError>;
}

export class TombstoneRepository extends Context.Tag("TombstoneRepository")<
	TombstoneRepository,
	TombstoneRepositoryShape
>() {}
