import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { IrComponent } from "#src/data/ir.ts";
import type { EntityType } from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { ComponentId, EntityId } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// ComponentRepository — data access for the dav_component / dav_property /
// dav_parameter tables (the normalized IrDocument content layer).
// ---------------------------------------------------------------------------

export interface ComponentRepositoryShape {
	/**
	 * Persists the full IrComponent tree for a new entity in one DB transaction.
	 * Returns the id of the root component row.
	 */
	readonly insertTree: (
		entityId: EntityId,
		root: IrComponent,
	) => Effect.Effect<ComponentId, DatabaseError>;

	/**
	 * Loads and reconstructs the IrComponent tree for an entity.
	 * Returns Option.none() if no active component rows exist (entity not found
	 * or already deleted via deleteByEntity).
	 * entityType is required to derive isKnown for each property at load time.
	 */
	readonly loadTree: (
		entityId: EntityId,
		entityType: EntityType,
	) => Effect.Effect<Option.Option<IrComponent>, DatabaseError>;

	/**
	 * Batch variant of loadTree: reconstructs the IrComponent tree for many
	 * entities in a fixed **3 queries total** (component, property, parameter)
	 * regardless of how many entities are requested, instead of 3×N.
	 *
	 * Returns a map from entityId to its reconstructed tree. Entities with no
	 * active component rows are simply absent from the map (mirrors loadTree's
	 * Option.none()). The map has no guaranteed iteration order — callers that
	 * need ordering should order their own id list (ideally in SQL) and look
	 * each entity up by id.
	 */
	readonly loadTreesByIds: (
		entityIds: ReadonlyArray<EntityId>,
		entityType: EntityType,
	) => Effect.Effect<ReadonlyMap<EntityId, IrComponent>, DatabaseError>;

	/**
	 * Soft-deletes all dav_component rows for the entity.
	 * dav_property and dav_parameter rows are naturally invisible to loadTree
	 * afterwards since loadTree always starts from active component IDs.
	 */
	readonly deleteByEntity: (
		entityId: EntityId,
	) => Effect.Effect<void, DatabaseError>;
}

export class ComponentRepository extends Context.Service<
	ComponentRepository,
	ComponentRepositoryShape
>()("ComponentRepository") {}
