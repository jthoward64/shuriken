import type { Effect } from "effect";
import { Context } from "effect";
import type { IrDeadProperties } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import type { CollectionId, InstanceId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { InstanceRow, NewInstance } from "./repository.ts";

// ---------------------------------------------------------------------------
// InstanceService — business logic for DAV object instance management
// ---------------------------------------------------------------------------

export interface InstanceServiceShape {
	readonly findById: (
		id: InstanceId,
	) => Effect.Effect<InstanceRow, DavError | DatabaseError>;
	readonly findBySlug: (
		collectionId: CollectionId,
		slug: Slug,
	) => Effect.Effect<InstanceRow, DavError | DatabaseError>;
	readonly listByCollection: (
		collectionId: CollectionId,
	) => Effect.Effect<ReadonlyArray<InstanceRow>, DatabaseError>;
	readonly put: (
		input: NewInstance,
		existingId?: InstanceId,
	) => Effect.Effect<InstanceRow, DavError | DatabaseError>;
	readonly delete: (
		id: InstanceId,
	) => Effect.Effect<void, DavError | DatabaseError>;
	/**
	 * Permanently remove an instance with no trash-bin recovery. Used only
	 * when trash retention is disabled (0 days) — the normal delete path is
	 * {@link InstanceServiceShape.delete}.
	 */
	readonly hardDelete: (
		id: InstanceId,
	) => Effect.Effect<void, DavError | DatabaseError>;
	readonly updateClientProperties: (
		id: InstanceId,
		clientProperties: IrDeadProperties,
	) => Effect.Effect<InstanceRow, DatabaseError>;
}

export class InstanceService extends Context.Service<
	InstanceService,
	InstanceServiceShape
>()("InstanceService") {}
