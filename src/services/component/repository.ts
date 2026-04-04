import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { IrComponent } from "#src/data/ir.ts";
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
		entityType: "icalendar" | "vcard",
	) => Effect.Effect<Option.Option<IrComponent>, DatabaseError>;

	/**
	 * Soft-deletes all dav_component rows for the entity.
	 * dav_property and dav_parameter rows are naturally invisible to loadTree
	 * afterwards since loadTree always starts from active component IDs.
	 */
	readonly deleteByEntity: (
		entityId: EntityId,
	) => Effect.Effect<void, DatabaseError>;
}

export class ComponentRepository extends Context.Tag("ComponentRepository")<
	ComponentRepository,
	ComponentRepositoryShape
>() {}
