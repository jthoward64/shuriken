import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { davInstance } from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, EntityId, InstanceId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { ETag } from "#src/domain/types/strings.ts";

// ---------------------------------------------------------------------------
// InstanceRepository — data access for dav_instance rows
// ---------------------------------------------------------------------------

export type InstanceRow = InferSelectModel<typeof davInstance>;

export interface NewInstance {
	readonly collectionId: CollectionId;
	readonly entityId: EntityId;
	readonly contentType: string;
	readonly etag: ETag;
	readonly slug: Slug;
	readonly scheduleTag?: string;
}

export interface InstanceRepositoryShape {
	readonly findById: (
		id: InstanceId,
	) => Effect.Effect<Option.Option<InstanceRow>, DatabaseError>;
	readonly findBySlug: (
		collectionId: CollectionId,
		slug: Slug,
	) => Effect.Effect<Option.Option<InstanceRow>, DatabaseError>;
	readonly listByCollection: (
		collectionId: CollectionId,
	) => Effect.Effect<ReadonlyArray<InstanceRow>, DatabaseError>;
	readonly findChangedSince: (
		collectionId: CollectionId,
		sinceSyncRevision: number,
	) => Effect.Effect<ReadonlyArray<InstanceRow>, DatabaseError>;
	readonly findByIds: (
		ids: ReadonlyArray<InstanceId>,
	) => Effect.Effect<ReadonlyArray<InstanceRow>, DatabaseError>;
	readonly insert: (
		input: NewInstance,
	) => Effect.Effect<InstanceRow, DatabaseError>;
	/** The sync trigger owns sync_revision; callers must not pass it. */
	readonly updateEtag: (
		id: InstanceId,
		etag: ETag,
	) => Effect.Effect<void, DatabaseError>;
	readonly softDelete: (id: InstanceId) => Effect.Effect<void, DatabaseError>;
	/** Move an instance to a different collection and/or slug in-place.
	 * Preserves entity identity, etag, lastModified, and clientProperties. */
	readonly relocate: (
		id: InstanceId,
		targetCollectionId: CollectionId,
		targetSlug: Slug,
	) => Effect.Effect<InstanceRow, DatabaseError>;
}

export class InstanceRepository extends Context.Tag("InstanceRepository")<
	InstanceRepository,
	InstanceRepositoryShape
>() {}
