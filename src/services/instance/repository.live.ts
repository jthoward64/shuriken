import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import type { IrDeadProperties } from "#src/data/ir.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { davInstance } from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, EntityId, InstanceId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { ETag } from "#src/domain/types/strings.ts";
import { InstanceRepository, type NewInstance } from "./repository.ts";

// ---------------------------------------------------------------------------
// InstanceRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const findById = Effect.fn("InstanceRepository.findById")(
	function* (id: InstanceId) {
		yield* Effect.annotateCurrentSpan({ "instance.id": id });
		yield* Effect.logTrace("repo.instance.findById", { id });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(davInstance)
				.where(and(eq(davInstance.id, id), isNull(davInstance.deletedAt)))
				.limit(1),
		).pipe(Effect.map((r) => Option.fromNullable(r[0])));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.findById failed", e.cause),
	),
);

const findBySlug = Effect.fn("InstanceRepository.findBySlug")(
	function* (collectionId: CollectionId, slug: Slug) {
		yield* Effect.annotateCurrentSpan({
			"collection.id": collectionId,
			"instance.slug": slug,
		});
		yield* Effect.logTrace("repo.instance.findBySlug", { collectionId, slug });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(davInstance)
				.where(
					and(
						eq(davInstance.collectionId, collectionId),
						eq(davInstance.slug, slug),
						isNull(davInstance.deletedAt),
					),
				)
				.limit(1),
		).pipe(Effect.map((r) => Option.fromNullable(r[0])));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.findBySlug failed", e.cause),
	),
);

const listByCollection = Effect.fn("InstanceRepository.listByCollection")(
	function* (collectionId: CollectionId) {
		yield* Effect.annotateCurrentSpan({ "collection.id": collectionId });
		yield* Effect.logTrace("repo.instance.listByCollection", { collectionId });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(davInstance)
				.where(
					and(
						eq(davInstance.collectionId, collectionId),
						isNull(davInstance.deletedAt),
					),
				),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.listByCollection failed", e.cause),
	),
);

const findChangedSince = Effect.fn("InstanceRepository.findChangedSince")(
	function* (collectionId: CollectionId, sinceSyncRevision: number) {
		yield* Effect.annotateCurrentSpan({
			"collection.id": collectionId,
			"instance.since_revision": sinceSyncRevision,
		});
		yield* Effect.logTrace("repo.instance.findChangedSince", {
			collectionId,
			sinceSyncRevision,
		});
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(davInstance)
				.where(
					and(
						eq(davInstance.collectionId, collectionId),
						gt(davInstance.syncRevision, sinceSyncRevision),
						isNull(davInstance.deletedAt),
					),
				)
				.orderBy(davInstance.syncRevision),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.findChangedSince failed", e.cause),
	),
);

const findByIds = Effect.fn("InstanceRepository.findByIds")(
	function* (ids: ReadonlyArray<InstanceId>) {
		yield* Effect.annotateCurrentSpan({ "instance.count": ids.length });
		yield* Effect.logTrace("repo.instance.findByIds", { count: ids.length });
		if (ids.length === 0) {
			return [];
		}
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(davInstance)
				.where(
					and(
						inArray(davInstance.id, ids as Array<InstanceId>),
						isNull(davInstance.deletedAt),
					),
				),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.findByIds failed", e.cause),
	),
);

const insertInstance = Effect.fn("InstanceRepository.insert")(
	function* (input: NewInstance) {
		yield* Effect.annotateCurrentSpan({
			"collection.id": input.collectionId,
			"instance.slug": input.slug,
		});
		yield* Effect.logTrace("repo.instance.insert", {
			collectionId: input.collectionId,
			slug: input.slug,
		});
		return yield* runDbQuery((db) =>
			db
				.insert(davInstance)
				.values({
					collectionId: input.collectionId,
					entityId: input.entityId as unknown as EntityId,
					contentType: input.contentType,
					etag: input.etag,
					slug: input.slug,
					scheduleTag: input.scheduleTag,
					...(input.clientProperties !== undefined
						? { clientProperties: input.clientProperties }
						: {}),
					...(input.contentLength !== undefined
						? { contentLength: input.contentLength }
						: {}),
				})
				.returning(),
		).pipe(
			Effect.flatMap((r) => {
				const row = r[0];
				if (!row) {
					return Effect.fail(
						new DatabaseError({ cause: new Error("Insert returned no rows") }),
					);
				}
				return Effect.succeed(row);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.insert failed", e.cause),
	),
);

const updateEtag = Effect.fn("InstanceRepository.updateEtag")(
	function* (id: InstanceId, etag: ETag, contentLength?: number) {
		yield* Effect.annotateCurrentSpan({ "instance.id": id });
		yield* Effect.logTrace("repo.instance.updateEtag", { id });
		return yield* runDbQuery((db) =>
			db
				.update(davInstance)
				.set({
					etag,
					updatedAt: sql`now()`,
					...(contentLength !== undefined ? { contentLength } : {}),
				})
				.where(eq(davInstance.id, id)),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.updateEtag failed", e.cause),
	),
);

const softDelete = Effect.fn("InstanceRepository.softDelete")(
	function* (id: InstanceId) {
		yield* Effect.annotateCurrentSpan({ "instance.id": id });
		yield* Effect.logTrace("repo.instance.softDelete", { id });
		return yield* runDbQuery((db) =>
			db
				.update(davInstance)
				.set({ deletedAt: sql`now()` })
				.where(eq(davInstance.id, id)),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.softDelete failed", e.cause),
	),
);

const relocate = Effect.fn("InstanceRepository.relocate")(
	function* (
		id: InstanceId,
		targetCollectionId: CollectionId,
		targetSlug: Slug,
	) {
		yield* Effect.annotateCurrentSpan({
			"instance.id": id,
			"collection.id": targetCollectionId,
			"instance.target_slug": targetSlug,
		});
		yield* Effect.logTrace("repo.instance.relocate", {
			id,
			targetCollectionId,
			targetSlug,
		});
		return yield* runDbQuery((db) =>
			db
				.update(davInstance)
				.set({
					collectionId: targetCollectionId,
					slug: targetSlug,
					updatedAt: sql`now()`,
				})
				.where(and(eq(davInstance.id, id), isNull(davInstance.deletedAt)))
				.returning(),
		).pipe(
			Effect.flatMap((rows) => {
				const row = rows[0];
				if (!row) {
					return Effect.fail(
						new DatabaseError({
							cause: new Error(`Instance not found for relocation: ${id}`),
						}),
					);
				}
				return Effect.succeed(row);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.relocate failed", e.cause),
	),
);

const updateClientProperties = Effect.fn(
	"InstanceRepository.updateClientProperties",
)(
	function* (id: InstanceId, clientProperties: IrDeadProperties) {
		yield* Effect.annotateCurrentSpan({ "instance.id": id });
		yield* Effect.logTrace("repo.instance.updateClientProperties", { id });
		return yield* runDbQuery((db) =>
			db
				.update(davInstance)
				.set({ clientProperties, updatedAt: sql`now()` })
				.where(and(eq(davInstance.id, id), isNull(davInstance.deletedAt)))
				.returning(),
		).pipe(
			Effect.flatMap((rows) => {
				const row = rows[0];
				if (!row) {
					return Effect.fail(
						new DatabaseError({
							cause: new Error(`Instance not found for property update: ${id}`),
						}),
					);
				}
				return Effect.succeed(row);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.updateClientProperties failed", e.cause),
	),
);

export const InstanceRepositoryLive = Layer.effect(
	InstanceRepository,
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(
			e: Effect.Effect<A, E, DatabaseClient>,
		): Effect.Effect<A, E> => Effect.provideService(e, DatabaseClient, dc);
		return InstanceRepository.of({
			findById: (...args: Parameters<typeof findById>) =>
				run(findById(...args)),
			findBySlug: (...args: Parameters<typeof findBySlug>) =>
				run(findBySlug(...args)),
			listByCollection: (...args: Parameters<typeof listByCollection>) =>
				run(listByCollection(...args)),
			findChangedSince: (...args: Parameters<typeof findChangedSince>) =>
				run(findChangedSince(...args)),
			findByIds: (...args: Parameters<typeof findByIds>) =>
				run(findByIds(...args)),
			insert: (...args: Parameters<typeof insertInstance>) =>
				run(insertInstance(...args)),
			updateEtag: (...args: Parameters<typeof updateEtag>) =>
				run(updateEtag(...args)),
			softDelete: (...args: Parameters<typeof softDelete>) =>
				run(softDelete(...args)),
			relocate: (...args: Parameters<typeof relocate>) =>
				run(relocate(...args)),
			updateClientProperties: (
				...args: Parameters<typeof updateClientProperties>
			) => run(updateClientProperties(...args)),
		});
	}),
);
