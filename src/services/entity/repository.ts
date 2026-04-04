import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { davEntity } from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { EntityId } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// EntityRepository — data access for dav_entity rows
// ---------------------------------------------------------------------------

export type EntityRow = InferSelectModel<typeof davEntity>;

export interface EntityRepositoryShape {
	readonly insert: (input: {
		readonly entityType: "icalendar" | "vcard";
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
}

export class EntityRepository extends Context.Tag("EntityRepository")<
	EntityRepository,
	EntityRepositoryShape
>() {}
