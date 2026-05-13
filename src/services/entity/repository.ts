import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { davEntity, EntityType } from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type {
	CollectionId,
	EntityId,
	InstanceId,
	PrincipalId,
} from "#src/domain/ids.ts";

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

	/**
	 * Snapshot of every active instance in a collection paired with its
	 * entity's logical UID. Used by the external-calendar sync engine to
	 * reconcile a parsed feed against the existing rows (uids in feed but
	 * not here → insert; uids here but not in feed → delete; intersection →
	 * replace contents). One join query per collection — cheaper than
	 * looping `findById` over every InstanceRow.
	 */
	readonly listActiveInstancesWithUid: (
		collectionId: CollectionId,
	) => Effect.Effect<
		ReadonlyArray<{
			readonly instanceId: InstanceId;
			readonly entityId: EntityId;
			readonly logicalUid: string | null;
			readonly etag: string;
			readonly slug: string;
		}>,
		DatabaseError
	>;
}

export class EntityRepository extends Context.Tag("EntityRepository")<
	EntityRepository,
	EntityRepositoryShape
>() {}
