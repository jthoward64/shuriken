import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Metric, Option } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import {
	davCollection,
	davEntity,
	davInstance,
	type EntityType,
} from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
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
	function* (input: { entityType: EntityType; logicalUid: string | null }) {
		yield* Effect.annotateCurrentSpan({ "entity.type": input.entityType });
		yield* Effect.logTrace("repo.entity.insert", {
			entityType: input.entityType,
			hasUid: input.logicalUid !== null,
		});
		return yield* runDbQuery((db) =>
			db
				.insert(davEntity)
				.values({
					entityType: input.entityType,
					logicalUid: input.logicalUid,
				})
				.returning(),
		).pipe(
			Effect.flatMap((r) => {
				const row = r[0];
				if (!row) {
					return Effect.fail(
						new DatabaseError({ cause: new Error("Entity insert returned no rows") }),
					);
				}
				return Effect.succeed(row);
			}),
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
	function* (id: EntityId) {
		yield* Effect.annotateCurrentSpan({ "entity.id": id });
		yield* Effect.logTrace("repo.entity.findById", { id });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(davEntity)
				.where(and(eq(davEntity.id, id), isNull(davEntity.deletedAt)))
				.limit(1),
		).pipe(
			Effect.map((r) => Option.fromNullable(r[0])),
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
	function* (id: EntityId, logicalUid: string | null) {
		yield* Effect.annotateCurrentSpan({
			"entity.id": id,
			"entity.has_uid": logicalUid !== null,
		});
		yield* Effect.logTrace("repo.entity.updateLogicalUid", {
			id,
			hasUid: logicalUid !== null,
		});
		return yield* runDbQuery((db) =>
			db
				.update(davEntity)
				.set({ logicalUid, updatedAt: sql`now()` })
				.where(eq(davEntity.id, id)),
		).pipe(
			Effect.asVoid,
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
	function* (id: EntityId) {
		yield* Effect.annotateCurrentSpan({ "entity.id": id });
		yield* Effect.logTrace("repo.entity.softDelete", { id });
		return yield* runDbQuery((db) =>
			db
				.update(davEntity)
				.set({ deletedAt: sql`now()` })
				.where(eq(davEntity.id, id)),
		).pipe(
			Effect.asVoid,
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
	function* (collectionId: CollectionId, logicalUid: string) {
		yield* Effect.annotateCurrentSpan({
			"collection.id": collectionId,
			"entity.logical_uid": logicalUid,
		});
		yield* Effect.logTrace("repo.entity.existsByUid", {
			collectionId,
			logicalUid,
		});
		return yield* runDbQuery((db) =>
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
				.limit(1),
		).pipe(
			Effect.map((r) => r.length > 0),
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
	function* (principalId: PrincipalId, logicalUid: string) {
		yield* Effect.annotateCurrentSpan({
			"principal.id": principalId,
			"entity.logical_uid": logicalUid,
		});
		yield* Effect.logTrace("repo.entity.existsByUidForPrincipal", {
			principalId,
			logicalUid,
		});
		return yield* runDbQuery((db) =>
			db
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
				.limit(1),
		).pipe(
			Effect.map((r) => r.length > 0),
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
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(e: Effect.Effect<A, E, DatabaseClient>): Effect.Effect<A, E> =>
			Effect.provideService(e, DatabaseClient, dc);
		return EntityRepository.of({
			insert: (...args: Parameters<typeof insertEntity>) => run(insertEntity(...args)),
			findById: (...args: Parameters<typeof findById>) => run(findById(...args)),
			updateLogicalUid: (...args: Parameters<typeof updateLogicalUid>) =>
				run(updateLogicalUid(...args)),
			softDelete: (...args: Parameters<typeof softDelete>) => run(softDelete(...args)),
			existsByUid: (...args: Parameters<typeof existsByUid>) => run(existsByUid(...args)),
			existsByUidForPrincipal: (...args: Parameters<typeof existsByUidForPrincipal>) =>
				run(existsByUidForPrincipal(...args)),
		});
	}),
);
