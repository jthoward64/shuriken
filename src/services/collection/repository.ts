import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { Temporal } from "temporal-polyfill";
import type { IrDeadProperties } from "#src/data/ir.ts";
import type {
	CollectionType,
	davCollection,
} from "#src/db/drizzle/schema/index.ts";

export type { CollectionType } from "#src/db/drizzle/schema/index.ts";

import type { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";

// ---------------------------------------------------------------------------
// CollectionRepository — data access for dav_collection rows
// ---------------------------------------------------------------------------

export type CollectionRow = InferSelectModel<typeof davCollection>;

export interface NewCollection {
	readonly ownerPrincipalId: PrincipalId;
	readonly collectionType: CollectionType;
	readonly slug: Slug;
	readonly displayName?: string;
	readonly description?: string;
	readonly timezoneTzid?: string;
	readonly supportedComponents?: Array<string>;
	readonly parentCollectionId?: CollectionId;
	/** Marks the collection as server-managed (e.g. "birthdays"); see schema. */
	readonly autoManagedKind?: string;
	/**
	 * Initial sort_order. Omit to let the repository pick the type-default
	 * (generated collections get 1000, everything else the DB default -1000);
	 * the subscription flow passes 0 so subscriptions sort below normal
	 * collections. See src/services/collection/sort-order.ts.
	 */
	readonly sortOrder?: number;
	/**
	 * RFC 6638 §9.2: schedule-default-calendar-URL (inbox only). Set at creation
	 * so a freshly provisioned principal can receive auto-placed scheduling
	 * objects without the client first having to PROPPATCH the inbox.
	 */
	readonly scheduleDefaultCalendarId?: CollectionId;
}

export interface CollectionPropertyChanges {
	readonly clientProperties: IrDeadProperties;
	/** undefined = leave unchanged; null = clear the value */
	readonly displayName?: string | null;
	/** undefined = leave unchanged; null = clear the value */
	readonly description?: string | null;
	/** undefined = leave unchanged; null = clear the value */
	readonly timezoneTzid?: string | null;
	/** RFC 6638 §9.1: schedule-calendar-transp. undefined = leave unchanged; null = reset to "opaque" */
	readonly scheduleTransp?: "opaque" | "transparent" | null;
	/** RFC 6638 §9.2: schedule-default-calendar-URL (inbox only). undefined = leave unchanged; null = clear */
	readonly scheduleDefaultCalendarId?: CollectionId | null;
	/** Apple `calendar-order` dead property. undefined = leave unchanged. The UI
	 * drag-reorder uses the batch {@link CollectionRepositoryShape.reorder}
	 * instead; this path is for a direct PROPPATCH of calendar-order. */
	readonly sortOrder?: number;
}

export interface CollectionRepositoryShape {
	readonly findById: (
		id: CollectionId,
	) => Effect.Effect<Option.Option<CollectionRow>, DatabaseError>;
	/**
	 * Batch variant of findById: resolve many collections in a single
	 * `WHERE id IN (...)` query. Returns a map keyed by collection id; ids that
	 * don't resolve (or are soft-deleted) are simply absent from the map.
	 */
	readonly findByIds: (
		ids: ReadonlyArray<CollectionId>,
	) => Effect.Effect<ReadonlyMap<CollectionId, CollectionRow>, DatabaseError>;
	/**
	 * Find a soft-deleted collection by id, without owner filtering. Used by
	 * TrashService to verify ownership before restore/purge — findById alone
	 * can't see soft-deleted rows.
	 */
	readonly findDeletedById: (
		id: CollectionId,
	) => Effect.Effect<Option.Option<CollectionRow>, DatabaseError>;
	readonly findBySlug: (
		ownerPrincipalId: PrincipalId,
		collectionType: CollectionType,
		slug: Slug,
	) => Effect.Effect<Option.Option<CollectionRow>, DatabaseError>;
	/** Active collections owned by the principal, ordered by (sortOrder, id).
	 * Callers filter by collectionType to get a single kind's ordered list. */
	readonly listByOwner: (
		ownerPrincipalId: PrincipalId,
	) => Effect.Effect<ReadonlyArray<CollectionRow>, DatabaseError>;
	/** Soft-deleted collections owned by the principal — the trash bin listing. */
	readonly listDeletedByOwner: (
		ownerPrincipalId: PrincipalId,
	) => Effect.Effect<ReadonlyArray<CollectionRow>, DatabaseError>;
	/**
	 * Every soft-deleted collection (any owner) whose `deleted_at` is older
	 * than `cutoff`. Used by the trash purge job's periodic sweep.
	 */
	readonly listDeletedOlderThan: (
		cutoff: Temporal.Instant,
	) => Effect.Effect<ReadonlyArray<CollectionRow>, DatabaseError>;
	/**
	 * List every active collection whose `auto_managed_kind` matches. Used by
	 * the corresponding generator's scheduler tick — e.g. BirthdayService asks
	 * for `kind = "birthdays"` to know which collections to reconcile.
	 */
	readonly listByAutoManagedKind: (
		kind: string,
	) => Effect.Effect<ReadonlyArray<CollectionRow>, DatabaseError>;
	/**
	 * Collections the given principal-set has a direct grant on but does NOT
	 * own. Used by `listOwnedAndShared` (src/http/ui/helpers/shared-collections.ts)
	 * to merge shared calendars/address books into the Calendar/Contacts
	 * sidebars. `principalIds` should be the caller's own principal id plus the
	 * principal ids of every group they belong to so group-granted shares are
	 * also returned. `privileges` is the set of acceptable DAV privileges — any
	 * matching ACE qualifies the collection.
	 */
	readonly listSharedWithPrincipals: (
		principalIds: ReadonlyArray<PrincipalId>,
		privileges: ReadonlyArray<string>,
	) => Effect.Effect<ReadonlyArray<CollectionRow>, DatabaseError>;
	readonly insert: (
		input: NewCollection,
	) => Effect.Effect<CollectionRow, DatabaseError>;
	readonly softDelete: (
		id: CollectionId,
	) => Effect.Effect<CollectionRow, DatabaseError>;
	/** Clear deleted_at on a soft-deleted collection (trash bin restore).
	 * Fails DatabaseError if no soft-deleted row matches. */
	readonly restore: (
		id: CollectionId,
	) => Effect.Effect<CollectionRow, DatabaseError>;
	/**
	 * Permanently remove a collection row (0-retention deletes, purge job).
	 * `dav_instance.collection_id` is ON DELETE RESTRICT, so instances under
	 * the collection (soft-deleted or not) are hard-deleted first, in the
	 * same transaction, before the collection row itself is removed.
	 */
	readonly hardDelete: (id: CollectionId) => Effect.Effect<void, DatabaseError>;
	/** Move a collection to a different owner principal and/or slug in-place.
	 * All instances follow automatically via their collectionId FK. */
	readonly relocate: (
		id: CollectionId,
		targetOwnerPrincipalId: PrincipalId,
		targetSlug: Slug,
	) => Effect.Effect<CollectionRow, DatabaseError>;
	/** Update dead properties and/or modifiable live properties atomically. */
	readonly updateProperties: (
		id: CollectionId,
		changes: CollectionPropertyChanges,
	) => Effect.Effect<CollectionRow, DatabaseError>;
	/** Apply a batch of sort_order changes (id -> new value) in one statement.
	 * Used by the UI drag-reorder; an empty map is a no-op. */
	readonly reorder: (
		changes: ReadonlyMap<CollectionId, number>,
	) => Effect.Effect<void, DatabaseError>;
}

export class CollectionRepository extends Context.Service<
	CollectionRepository,
	CollectionRepositoryShape
>()("CollectionRepository") {}
