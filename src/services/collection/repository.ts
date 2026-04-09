import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { IrDeadProperties } from "#src/data/ir.ts";
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

export interface CollectionPropertyChanges {
	readonly clientProperties: IrDeadProperties;
	/** undefined = leave unchanged; null = clear the value */
	readonly displayName?: string | null;
	/** undefined = leave unchanged; null = clear the value */
	readonly description?: string | null;
	/** undefined = leave unchanged; null = clear the value */
	readonly timezoneTzid?: string | null;
}

export interface CollectionRepositoryShape {
	readonly findById: (
		id: CollectionId,
	) => Effect.Effect<Option.Option<CollectionRow>, DatabaseError>;
	readonly findBySlug: (
		ownerPrincipalId: PrincipalId,
		collectionType: string,
		slug: Slug,
	) => Effect.Effect<Option.Option<CollectionRow>, DatabaseError>;
	readonly listByOwner: (
		ownerPrincipalId: PrincipalId,
	) => Effect.Effect<ReadonlyArray<CollectionRow>, DatabaseError>;
	readonly insert: (
		input: NewCollection,
	) => Effect.Effect<CollectionRow, DatabaseError>;
	readonly softDelete: (
		id: CollectionId,
	) => Effect.Effect<CollectionRow, DatabaseError>;
	/** Move a collection to a different owner principal and/or slug in-place.
	 * All instances follow automatically via their collectionId FK. */
	readonly relocate: (
		id: CollectionId,
		targetOwnerPrincipalId: PrincipalId,
		targetSlug: Slug,
	) => Effect.Effect<CollectionRow, DatabaseError>;
	/** Update dead properties and/or modifiable live properties atomically. */
	readonly updateProperties: (
		id: CollectionId,
		changes: CollectionPropertyChanges,
	) => Effect.Effect<CollectionRow, DatabaseError>;
}

export class CollectionRepository extends Context.Tag("CollectionRepository")<
	CollectionRepository,
	CollectionRepositoryShape
>() {}
