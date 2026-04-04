import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { davCollection } from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";

// ---------------------------------------------------------------------------
// CollectionRepository — data access for dav_collection rows
// ---------------------------------------------------------------------------

export type CollectionRow = InferSelectModel<typeof davCollection>;

export interface NewCollection {
	readonly ownerPrincipalId: PrincipalId;
	readonly collectionType: string;
	readonly slug: Slug;
	readonly displayName?: string;
	readonly description?: string;
	readonly timezoneTzid?: string;
	readonly supportedComponents?: Array<string>;
	readonly parentCollectionId?: CollectionId;
}

export interface CollectionRepositoryShape {
	readonly findById: (
		id: CollectionId,
	) => Effect.Effect<Option.Option<CollectionRow>, DatabaseError>;
	readonly findBySlug: (
		ownerPrincipalId: PrincipalId,
		slug: Slug,
	) => Effect.Effect<Option.Option<CollectionRow>, DatabaseError>;
	readonly listByOwner: (
		ownerPrincipalId: PrincipalId,
	) => Effect.Effect<ReadonlyArray<CollectionRow>, DatabaseError>;
	readonly insert: (
		input: NewCollection,
	) => Effect.Effect<CollectionRow, DatabaseError>;
	readonly softDelete: (id: CollectionId) => Effect.Effect<CollectionRow, DatabaseError>;
}

export class CollectionRepository extends Context.Tag("CollectionRepository")<
	CollectionRepository,
	CollectionRepositoryShape
>() {}
