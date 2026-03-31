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

export type NewInstance = {
  readonly collectionId: CollectionId;
  readonly entityId: EntityId;
  readonly contentType: string;
  readonly etag: string;
  readonly slug: Slug;
  readonly syncRevision?: number;
  readonly scheduleTag?: string;
};

export interface InstanceRepositoryShape {
  readonly findById: (
    id: InstanceId,
  ) => Effect<InstanceRow | null, DatabaseError>;
  readonly findBySlug: (
    collectionId: CollectionId,
    slug: Slug,
  ) => Effect<InstanceRow | null, DatabaseError>;
  readonly listByCollection: (
    collectionId: CollectionId,
  ) => Effect<ReadonlyArray<InstanceRow>, DatabaseError>;
  readonly insert: (input: NewInstance) => Effect<InstanceRow, DatabaseError>;
  readonly updateEtag: (
    id: InstanceId,
    etag: string,
    syncRevision: number,
  ) => Effect<void, DatabaseError>;
  readonly softDelete: (id: InstanceId) => Effect<void, DatabaseError>;
}

export class InstanceRepository extends Context.Tag("InstanceRepository")<
  InstanceRepository,
  InstanceRepositoryShape
>() {}
