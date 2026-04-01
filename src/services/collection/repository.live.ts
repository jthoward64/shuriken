import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { davCollection } from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import { CollectionRepository, type NewCollection } from "./repository.ts";

// ---------------------------------------------------------------------------
// CollectionRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const findById = (db: DbClient, id: CollectionId) =>
	Effect.tryPromise({
		try: () =>
			db
				.select()
				.from(davCollection)
				.where(and(eq(davCollection.id, id), isNull(davCollection.deletedAt)))
				.limit(1)
				.then((r) => Option.fromNullable(r[0])),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const findBySlug = (db: DbClient, ownerPrincipalId: PrincipalId, slug: Slug) =>
	Effect.tryPromise({
		try: () =>
			db
				.select()
				.from(davCollection)
				.where(
					and(
						eq(davCollection.ownerPrincipalId, ownerPrincipalId),
						eq(davCollection.slug, slug),
						isNull(davCollection.deletedAt),
					),
				)
				.limit(1)
				.then((r) => Option.fromNullable(r[0])),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const listByOwner = (db: DbClient, ownerPrincipalId: PrincipalId) =>
	Effect.tryPromise({
		try: () =>
			db
				.select()
				.from(davCollection)
				.where(
					and(
						eq(davCollection.ownerPrincipalId, ownerPrincipalId),
						isNull(davCollection.deletedAt),
					),
				),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const insert = (db: DbClient, input: NewCollection) =>
	Effect.tryPromise({
		try: () =>
			db
				.insert(davCollection)
				.values({
					ownerPrincipalId: input.ownerPrincipalId,
					collectionType: input.collectionType,
					slug: input.slug,
					displayName: input.displayName,
					description: input.description,
					timezoneTzid: input.timezoneTzid,
					supportedComponents: input.supportedComponents,
					parentCollectionId: input.parentCollectionId,
				})
				.returning()
				.then((r) => {
					const row = r[0];
					if (!row) {
						throw new Error("Insert returned no rows");
					}
					return row;
				}),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const softDelete = (db: DbClient, id: CollectionId) =>
	Effect.tryPromise({
		try: () =>
			db
				.update(davCollection)
				.set({ deletedAt: sql`now()` })
				.where(eq(davCollection.id, id))
				.then(() => undefined),
		catch: (e) => new DatabaseError({ cause: e }),
	});

export const CollectionRepositoryLive = Layer.effect(
	CollectionRepository,
	Effect.map(DatabaseClient, (db) =>
		CollectionRepository.of({
			findById: (id) => findById(db, id),
			findBySlug: (owner, slug) => findBySlug(db, owner, slug),
			listByOwner: (owner) => listByOwner(db, owner),
			insert: (input) => insert(db, input),
			softDelete: (id) => softDelete(db, id),
		}),
	),
);
