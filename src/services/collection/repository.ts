import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Context } from "effect";
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
}

export interface CollectionRepositoryShape {
	readonly findById: (
		id: CollectionId,
	) => Effect.Effect<Option.Option<CollectionRow>, DatabaseError>;
	readonly findBySlug: (
		ownerPrincipalId: PrincipalId,
		collectionType: CollectionType,
		slug: Slug,
	) => Effect.Effect<Option.Option<CollectionRow>, DatabaseError>;
	readonly listByOwner: (
		ownerPrincipalId: PrincipalId,
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
	 * own. Used by the "Shared with me" UI section. `principalIds` should be
	 * the caller's own principal id plus the principal ids of every group
	 * they belong to so group-granted shares are also returned. `privileges`
	 * is the set of acceptable DAV privileges — any matching ACE qualifies
	 * the collection.
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
}

export class CollectionRepository extends Context.Service<
	CollectionRepository,
	CollectionRepositoryShape
>()("CollectionRepository") {}
