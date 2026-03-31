import type { InferSelectModel } from "drizzle-orm";
import type { Effect } from "effect";
import { Context } from "effect";
import type { davCollection } from "#/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#/domain/ids.ts";
import type { Slug } from "#/domain/types/path.ts";

// ---------------------------------------------------------------------------
// CollectionRepository — data access for dav_collection rows
// ---------------------------------------------------------------------------

export type CollectionRow = InferSelectModel<typeof davCollection>;

export type NewCollection = {
	readonly ownerPrincipalId: PrincipalId;
	readonly collectionType: string;
	readonly slug: Slug;
	readonly displayName?: string;
	readonly description?: string;
	readonly timezoneTzid?: string;
	readonly supportedComponents?: string[];
	readonly parentCollectionId?: CollectionId;
};

export interface CollectionRepositoryShape {
	readonly findById: (
		id: CollectionId,
	) => Effect<CollectionRow | null, DatabaseError>;
	readonly findBySlug: (
		ownerPrincipalId: PrincipalId,
		slug: Slug,
	) => Effect<CollectionRow | null, DatabaseError>;
	readonly listByOwner: (
		ownerPrincipalId: PrincipalId,
	) => Effect<ReadonlyArray<CollectionRow>, DatabaseError>;
	readonly insert: (
		input: NewCollection,
	) => Effect<CollectionRow, DatabaseError>;
	readonly softDelete: (id: CollectionId) => Effect<void, DatabaseError>;
}

export class CollectionRepository extends Context.Tag("CollectionRepository")<
	CollectionRepository,
	CollectionRepositoryShape
>() {}
