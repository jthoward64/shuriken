import type { Effect } from "effect";
import { Context } from "effect";
import type { DatabaseError, DavError } from "#/domain/errors.ts";
import type { CollectionId, InstanceId } from "#/domain/ids.ts";
import type { Slug } from "#/domain/types/path.ts";
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
}

export class InstanceService extends Context.Tag("InstanceService")<
	InstanceService,
	InstanceServiceShape
>() {}
