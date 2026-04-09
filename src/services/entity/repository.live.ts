import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { davEntity, davInstance } from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, EntityId } from "#src/domain/ids.ts";
import { EntityRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// EntityRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const insertEntity = (
	db: DbClient,
	input: { entityType: "icalendar" | "vcard"; logicalUid: string | null },
) =>
	Effect.tryPromise({
		try: () =>
			db
				.insert(davEntity)
				.values({
					entityType: input.entityType,
					logicalUid: input.logicalUid,
				})
				.returning()
				.then((r) => {
					const row = r[0];
					if (!row) {
						throw new Error("Entity insert returned no rows");
					}
					return row;
				}),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const findById = (db: DbClient, id: EntityId) =>
	Effect.tryPromise({
		try: () =>
			db
				.select()
				.from(davEntity)
				.where(and(eq(davEntity.id, id), isNull(davEntity.deletedAt)))
				.limit(1)
				.then((r) => Option.fromNullable(r[0])),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const updateLogicalUid = (
	db: DbClient,
	id: EntityId,
	logicalUid: string | null,
) =>
	Effect.tryPromise({
		try: () =>
			db
				.update(davEntity)
				.set({ logicalUid, updatedAt: sql`now()` })
				.where(eq(davEntity.id, id))
				.then(() => undefined),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const softDelete = (db: DbClient, id: EntityId) =>
	Effect.tryPromise({
		try: () =>
			db
				.update(davEntity)
				.set({ deletedAt: sql`now()` })
				.where(eq(davEntity.id, id))
				.then(() => undefined),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const existsByUid = (
	db: DbClient,
	collectionId: CollectionId,
	logicalUid: string,
) =>
	Effect.tryPromise({
		try: () =>
			db
				.select({ id: davEntity.id })
				.from(davEntity)
				.innerJoin(davInstance, eq(davInstance.entityId, davEntity.id))
				.where(
					and(
						eq(davInstance.collectionId, collectionId),
						eq(davEntity.logicalUid, logicalUid),
						isNull(davInstance.deletedAt),
						isNull(davEntity.deletedAt),
					),
				)
				.limit(1)
				.then((r) => r.length > 0),
		catch: (e) => new DatabaseError({ cause: e }),
	});

export const EntityRepositoryLive = Layer.effect(
	EntityRepository,
	Effect.map(DatabaseClient, (db) =>
		EntityRepository.of({
			insert: (input) => insertEntity(db, input),
			findById: (id) => findById(db, id),
			updateLogicalUid: (id, uid) => updateLogicalUid(db, id, uid),
			softDelete: (id) => softDelete(db, id),
			existsByUid: (collectionId, uid) => existsByUid(db, collectionId, uid),
		}),
	),
);
