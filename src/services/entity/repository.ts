import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { davEntity, EntityType } from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, EntityId, PrincipalId } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// EntityRepository — data access for dav_entity rows
// ---------------------------------------------------------------------------

export type EntityRow = InferSelectModel<typeof davEntity>;

export interface EntityRepositoryShape {
	readonly insert: (input: {
		readonly entityType: EntityType;
		readonly logicalUid: string | null;
	}) => Effect.Effect<EntityRow, DatabaseError>;

	readonly findById: (
		id: EntityId,
	) => Effect.Effect<Option.Option<EntityRow>, DatabaseError>;

	readonly updateLogicalUid: (
		id: EntityId,
		logicalUid: string | null,
	) => Effect.Effect<void, DatabaseError>;

	readonly softDelete: (id: EntityId) => Effect.Effect<void, DatabaseError>;

	/** Returns true if any active instance in the given collection has the given logical UID. */
	readonly existsByUid: (
		collectionId: CollectionId,
		logicalUid: string,
	) => Effect.Effect<boolean, DatabaseError>;

	/**
	 * RFC 6638 §3.2.4.1: Returns true if any active instance in ANY calendar
	 * collection owned by the given principal has the given logical UID.
	 */
	readonly existsByUidForPrincipal: (
		principalId: PrincipalId,
		logicalUid: string,
	) => Effect.Effect<boolean, DatabaseError>;
}

export class EntityRepository extends Context.Tag("EntityRepository")<
	EntityRepository,
	EntityRepositoryShape
>() {}
