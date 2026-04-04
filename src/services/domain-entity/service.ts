import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { IrDocument } from "#src/data/ir.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { EntityId } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// DomainEntityService — unified facade over EntityRepository +
// ComponentRepository.
//
// Callers above this layer (DAV handlers, sync, scheduling) never access the
// two repositories directly. This service owns all entity + component-tree
// read/write operations and keeps logicalUid in sync on every write.
// ---------------------------------------------------------------------------

export interface DomainEntityServiceShape {
	/**
	 * Creates a new entity + component tree.
	 * Extracts the logical UID from the IR document automatically.
	 * Returns the new EntityId.
	 */
	readonly create: (input: {
		readonly entityType: "icalendar" | "vcard";
		readonly document: IrDocument;
	}) => Effect.Effect<EntityId, DatabaseError>;

	/**
	 * Loads the IR document for an entity.
	 * Returns Option.none() if the entity does not exist or has been deleted.
	 */
	readonly load: (
		id: EntityId,
	) => Effect.Effect<Option.Option<IrDocument>, DatabaseError>;

	/**
	 * Atomically replaces the component tree for an existing entity.
	 * Deletes the old tree and inserts the new one.
	 * Updates logicalUid to match the UID in the replacement document.
	 */
	readonly replace: (
		id: EntityId,
		document: IrDocument,
	) => Effect.Effect<void, DatabaseError>;

	/**
	 * Soft-deletes the entity and its entire component tree.
	 */
	readonly remove: (id: EntityId) => Effect.Effect<void, DatabaseError>;
}

export class DomainEntityService extends Context.Tag("DomainEntityService")<
	DomainEntityService,
	DomainEntityServiceShape
>() {}
