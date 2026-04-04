import type { Effect } from "effect";
import { Context } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { CollectionRow, NewCollection } from "./repository.ts";

// ---------------------------------------------------------------------------
// CollectionService — business logic for DAV collection management
// ---------------------------------------------------------------------------

export interface CollectionServiceShape {
	readonly findById: (
		id: CollectionId,
	) => Effect.Effect<CollectionRow, DavError | DatabaseError>;
	readonly findBySlug: (
		ownerPrincipalId: PrincipalId,
		slug: Slug,
	) => Effect.Effect<CollectionRow, DavError | DatabaseError>;
	readonly listByOwner: (
		ownerPrincipalId: PrincipalId,
	) => Effect.Effect<ReadonlyArray<CollectionRow>, DatabaseError>;
	readonly create: (
		input: NewCollection,
	) => Effect.Effect<CollectionRow, DavError | DatabaseError>;
	readonly delete: (
		id: CollectionId,
	) => Effect.Effect<CollectionRow, DavError | DatabaseError>;
}

export class CollectionService extends Context.Tag("CollectionService")<
	CollectionService,
	CollectionServiceShape
>() {}
