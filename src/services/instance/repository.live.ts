import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import type { IrDeadProperties } from "#src/data/ir.ts";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { davInstance } from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, EntityId, InstanceId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { ETag } from "#src/domain/types/strings.ts";
import { InstanceRepository, type NewInstance } from "./repository.ts";

// ---------------------------------------------------------------------------
// InstanceRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const findById = Effect.fn("InstanceRepository.findById")(
	function* (db: DbClient, id: InstanceId) {
		yield* Effect.logTrace("repo.instance.findById", { id });
		return yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(davInstance)
					.where(and(eq(davInstance.id, id), isNull(davInstance.deletedAt)))
					.limit(1)
					.then((r) => Option.fromNullable(r[0])),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.findById failed", e.cause),
	),
);

const findBySlug = Effect.fn("InstanceRepository.findBySlug")(
	function* (db: DbClient, collectionId: CollectionId, slug: Slug) {
		yield* Effect.logTrace("repo.instance.findBySlug", { collectionId, slug });
		return yield* Effect.tryPromise({
			try: () =>
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
					.limit(1)
					.then((r) => Option.fromNullable(r[0])),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.findBySlug failed", e.cause),
	),
);

const listByCollection = Effect.fn("InstanceRepository.listByCollection")(
	function* (db: DbClient, collectionId: CollectionId) {
		yield* Effect.logTrace("repo.instance.listByCollection", { collectionId });
		return yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(davInstance)
					.where(
						and(
							eq(davInstance.collectionId, collectionId),
							isNull(davInstance.deletedAt),
						),
					),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.listByCollection failed", e.cause),
	),
);

const findChangedSince = Effect.fn("InstanceRepository.findChangedSince")(
	function* (
		db: DbClient,
		collectionId: CollectionId,
		sinceSyncRevision: number,
	) {
		yield* Effect.logTrace("repo.instance.findChangedSince", {
			collectionId,
			sinceSyncRevision,
		});
		return yield* Effect.tryPromise({
			try: () =>
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
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.findChangedSince failed", e.cause),
	),
);

const findByIds = Effect.fn("InstanceRepository.findByIds")(
	function* (db: DbClient, ids: ReadonlyArray<InstanceId>) {
		yield* Effect.logTrace("repo.instance.findByIds", { count: ids.length });
		if (ids.length === 0) {
			return [];
		}
		return yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(davInstance)
					.where(
						and(
							inArray(davInstance.id, ids as Array<InstanceId>),
							isNull(davInstance.deletedAt),
						),
					),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.findByIds failed", e.cause),
	),
);

const insertInstance = Effect.fn("InstanceRepository.insert")(
	function* (db: DbClient, input: NewInstance) {
		yield* Effect.logTrace("repo.instance.insert", {
			collectionId: input.collectionId,
			slug: input.slug,
		});
		return yield* Effect.tryPromise({
			try: () =>
				db
					.insert(davInstance)
					.values({
						collectionId: input.collectionId,
						entityId: input.entityId as unknown as EntityId,
						contentType: input.contentType,
						etag: input.etag,
						slug: input.slug,
						scheduleTag: input.scheduleTag,
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
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.insert failed", e.cause),
	),
);

const updateEtag = Effect.fn("InstanceRepository.updateEtag")(
	function* (db: DbClient, id: InstanceId, etag: ETag) {
		yield* Effect.logTrace("repo.instance.updateEtag", { id });
		return yield* Effect.tryPromise({
			try: () =>
				db
					.update(davInstance)
					.set({ etag, updatedAt: sql`now()` })
					.where(eq(davInstance.id, id))
					.then(() => undefined),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.updateEtag failed", e.cause),
	),
);

const softDelete = Effect.fn("InstanceRepository.softDelete")(
	function* (db: DbClient, id: InstanceId) {
		yield* Effect.logTrace("repo.instance.softDelete", { id });
		return yield* Effect.tryPromise({
			try: () =>
				db
					.update(davInstance)
					.set({ deletedAt: sql`now()` })
					.where(eq(davInstance.id, id))
					.then(() => undefined),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.softDelete failed", e.cause),
	),
);

const relocate = Effect.fn("InstanceRepository.relocate")(
	function* (
		db: DbClient,
		id: InstanceId,
		targetCollectionId: CollectionId,
		targetSlug: Slug,
	) {
		yield* Effect.logTrace("repo.instance.relocate", {
			id,
			targetCollectionId,
			targetSlug,
		});
		return yield* Effect.tryPromise({
			try: () =>
				db
					.update(davInstance)
					.set({
						collectionId: targetCollectionId,
						slug: targetSlug,
						updatedAt: sql`now()`,
					})
					.where(and(eq(davInstance.id, id), isNull(davInstance.deletedAt)))
					.returning()
					.then((rows) => {
						const row = rows[0];
						if (!row) {
							throw new Error(`Instance not found for relocation: ${id}`);
						}
						return row;
					}),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.relocate failed", e.cause),
	),
);

const updateClientProperties = Effect.fn(
	"InstanceRepository.updateClientProperties",
)(
	function* (db: DbClient, id: InstanceId, clientProperties: IrDeadProperties) {
		yield* Effect.logTrace("repo.instance.updateClientProperties", { id });
		return yield* Effect.tryPromise({
			try: () =>
				db
					.update(davInstance)
					.set({ clientProperties, updatedAt: sql`now()` })
					.where(and(eq(davInstance.id, id), isNull(davInstance.deletedAt)))
					.returning()
					.then((rows) => {
						const row = rows[0];
						if (!row) {
							throw new Error(`Instance not found for property update: ${id}`);
						}
						return row;
					}),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.updateClientProperties failed", e.cause),
	),
);

export const InstanceRepositoryLive = Layer.effect(
	InstanceRepository,
	Effect.map(DatabaseClient, (db) =>
		InstanceRepository.of({
			findById: (id) => findById(db, id),
			findBySlug: (col, slug) => findBySlug(db, col, slug),
			listByCollection: (col) => listByCollection(db, col),
			findChangedSince: (col, since) => findChangedSince(db, col, since),
			findByIds: (ids) => findByIds(db, ids),
			insert: (input) => insertInstance(db, input),
			updateEtag: (id, etag) => updateEtag(db, id, etag),
			softDelete: (id) => softDelete(db, id),
			relocate: (id, col, slug) => relocate(db, id, col, slug),
			updateClientProperties: (id, props) =>
				updateClientProperties(db, id, props),
		}),
	),
);
