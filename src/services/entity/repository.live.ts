import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Metric, Option } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import {
	davCollection,
	davEntity,
	davInstance,
	type EntityType,
} from "#src/db/drizzle/schema/index.ts";
import { getActiveDb } from "#src/db/transaction.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, EntityId, PrincipalId } from "#src/domain/ids.ts";
import { repoQueryDurationMs } from "#src/observability/metrics.ts";
import { EntityRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// EntityRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const entityDuration = repoQueryDurationMs.pipe(
	Metric.tagged("repo.entity", "entity"),
);

const insertEntity = Effect.fn("EntityRepository.insert")(
	function* (
		db: DbClient,
		input: { entityType: EntityType; logicalUid: string | null },
	) {
		yield* Effect.annotateCurrentSpan({ "entity.type": input.entityType });
		yield* Effect.logTrace("repo.entity.insert", {
			entityType: input.entityType,
			hasUid: input.logicalUid !== null,
		});
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
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
		}).pipe(
			Metric.trackDuration(
				entityDuration.pipe(Metric.tagged("repo.operation", "insert")),
			),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.entity.insert failed", e.cause),
	),
);

const findById = Effect.fn("EntityRepository.findById")(
	function* (db: DbClient, id: EntityId) {
		yield* Effect.annotateCurrentSpan({ "entity.id": id });
		yield* Effect.logTrace("repo.entity.findById", { id });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.select()
					.from(davEntity)
					.where(and(eq(davEntity.id, id), isNull(davEntity.deletedAt)))
					.limit(1)
					.then((r) => Option.fromNullable(r[0])),
			catch: (e) => new DatabaseError({ cause: e }),
		}).pipe(
			Metric.trackDuration(
				entityDuration.pipe(Metric.tagged("repo.operation", "findById")),
			),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.entity.findById failed", e.cause),
	),
);

const updateLogicalUid = Effect.fn("EntityRepository.updateLogicalUid")(
	function* (db: DbClient, id: EntityId, logicalUid: string | null) {
		yield* Effect.annotateCurrentSpan({
			"entity.id": id,
			"entity.has_uid": logicalUid !== null,
		});
		yield* Effect.logTrace("repo.entity.updateLogicalUid", {
			id,
			hasUid: logicalUid !== null,
		});
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.update(davEntity)
					.set({ logicalUid, updatedAt: sql`now()` })
					.where(eq(davEntity.id, id))
					.then(() => undefined),
			catch: (e) => new DatabaseError({ cause: e }),
		}).pipe(
			Metric.trackDuration(
				entityDuration.pipe(
					Metric.tagged("repo.operation", "updateLogicalUid"),
				),
			),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.entity.updateLogicalUid failed", e.cause),
	),
);

const softDelete = Effect.fn("EntityRepository.softDelete")(
	function* (db: DbClient, id: EntityId) {
		yield* Effect.annotateCurrentSpan({ "entity.id": id });
		yield* Effect.logTrace("repo.entity.softDelete", { id });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.update(davEntity)
					.set({ deletedAt: sql`now()` })
					.where(eq(davEntity.id, id))
					.then(() => undefined),
			catch: (e) => new DatabaseError({ cause: e }),
		}).pipe(
			Metric.trackDuration(
				entityDuration.pipe(Metric.tagged("repo.operation", "softDelete")),
			),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.entity.softDelete failed", e.cause),
	),
);

const existsByUid = Effect.fn("EntityRepository.existsByUid")(
	function* (db: DbClient, collectionId: CollectionId, logicalUid: string) {
		yield* Effect.annotateCurrentSpan({
			"collection.id": collectionId,
			"entity.logical_uid": logicalUid,
		});
		yield* Effect.logTrace("repo.entity.existsByUid", {
			collectionId,
			logicalUid,
		});
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
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
		}).pipe(
			Metric.trackDuration(
				entityDuration.pipe(Metric.tagged("repo.operation", "existsByUid")),
			),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.entity.existsByUid failed", e.cause),
	),
);

const existsByUidForPrincipal = Effect.fn(
	"EntityRepository.existsByUidForPrincipal",
)(
	function* (db: DbClient, principalId: PrincipalId, logicalUid: string) {
		yield* Effect.annotateCurrentSpan({
			"principal.id": principalId,
			"entity.logical_uid": logicalUid,
		});
		yield* Effect.logTrace("repo.entity.existsByUidForPrincipal", {
			principalId,
			logicalUid,
		});
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.select({ id: davEntity.id })
					.from(davEntity)
					.innerJoin(davInstance, eq(davInstance.entityId, davEntity.id))
					.innerJoin(
						davCollection,
						eq(davCollection.id, davInstance.collectionId),
					)
					.where(
						and(
							eq(davCollection.ownerPrincipalId, principalId),
							eq(davCollection.collectionType, "calendar"),
							eq(davEntity.logicalUid, logicalUid),
							isNull(davInstance.deletedAt),
							isNull(davEntity.deletedAt),
							isNull(davCollection.deletedAt),
						),
					)
					.limit(1)
					.then((r) => r.length > 0),
			catch: (e) => new DatabaseError({ cause: e }),
		}).pipe(
			Metric.trackDuration(
				entityDuration.pipe(
					Metric.tagged("repo.operation", "existsByUidForPrincipal"),
				),
			),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.entity.existsByUidForPrincipal failed", e.cause),
	),
);

export const EntityRepositoryLive = Layer.effect(
	EntityRepository,
	Effect.map(DatabaseClient, (db) =>
		EntityRepository.of({
			insert: (input) => insertEntity(db, input),
			findById: (id) => findById(db, id),
			updateLogicalUid: (id, uid) => updateLogicalUid(db, id, uid),
			softDelete: (id) => softDelete(db, id),
			existsByUid: (collectionId, uid) => existsByUid(db, collectionId, uid),
			existsByUidForPrincipal: (principalId, uid) =>
				existsByUidForPrincipal(db, principalId, uid),
		}),
	),
);
