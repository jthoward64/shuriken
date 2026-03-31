import type { InferSelectModel } from "drizzle-orm";
import type { Effect } from "effect";
import { Context } from "effect";
import type { davInstance } from "#/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#/domain/errors.ts";
import type { CollectionId, EntityId, InstanceId } from "#/domain/ids.ts";
import type { Slug } from "#/domain/types/path.ts";

// ---------------------------------------------------------------------------
// InstanceRepository — data access for dav_instance rows
// ---------------------------------------------------------------------------

export type InstanceRow = InferSelectModel<typeof davInstance>;

export interface NewInstance {
	readonly collectionId: CollectionId;
	readonly entityId: EntityId;
	readonly contentType: string;
	readonly etag: string;
	readonly slug: Slug;
	readonly syncRevision?: number;
	readonly scheduleTag?: string;
}

export interface InstanceRepositoryShape {
	readonly findById: (
		id: InstanceId,
	) => Effect.Effect<InstanceRow | null, DatabaseError>;
	readonly findBySlug: (
		collectionId: CollectionId,
		slug: Slug,
	) => Effect.Effect<InstanceRow | null, DatabaseError>;
	readonly listByCollection: (
		collectionId: CollectionId,
	) => Effect.Effect<ReadonlyArray<InstanceRow>, DatabaseError>;
	readonly insert: (
		input: NewInstance,
	) => Effect.Effect<InstanceRow, DatabaseError>;
	readonly updateEtag: (
		id: InstanceId,
		etag: string,
		syncRevision: number,
	) => Effect.Effect<void, DatabaseError>;
	readonly softDelete: (id: InstanceId) => Effect.Effect<void, DatabaseError>;
}

export class InstanceRepository extends Context.Tag("InstanceRepository")<
	InstanceRepository,
	InstanceRepositoryShape
>() {}
