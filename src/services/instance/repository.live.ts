import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
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

const findById = Effect.fn("InstanceRepository.findById")(function* (
	db: DbClient,
	id: InstanceId,
) {
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
}, Effect.tapError((e) => Effect.logWarning("repo.instance.findById failed", e.cause)));

const findBySlug = Effect.fn("InstanceRepository.findBySlug")(function* (
	db: DbClient,
	collectionId: CollectionId,
	slug: Slug,
) {
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
}, Effect.tapError((e) => Effect.logWarning("repo.instance.findBySlug failed", e.cause)));

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

const insertInstance = Effect.fn("InstanceRepository.insert")(function* (
	db: DbClient,
	input: NewInstance,
) {
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
					syncRevision: input.syncRevision ?? 1,
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
}, Effect.tapError((e) => Effect.logWarning("repo.instance.insert failed", e.cause)));

const updateEtag = Effect.fn("InstanceRepository.updateEtag")(function* (
	db: DbClient,
	id: InstanceId,
	etag: ETag,
	syncRevision: number,
) {
	yield* Effect.logTrace("repo.instance.updateEtag", { id, syncRevision });
	return yield* Effect.tryPromise({
		try: () =>
			db
				.update(davInstance)
				.set({ etag, syncRevision, updatedAt: sql`now()` })
				.where(eq(davInstance.id, id))
				.then(() => undefined),
		catch: (e) => new DatabaseError({ cause: e }),
	});
}, Effect.tapError((e) => Effect.logWarning("repo.instance.updateEtag failed", e.cause)));

const softDelete = Effect.fn("InstanceRepository.softDelete")(function* (
	db: DbClient,
	id: InstanceId,
) {
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
}, Effect.tapError((e) => Effect.logWarning("repo.instance.softDelete failed", e.cause)));

export const InstanceRepositoryLive = Layer.effect(
	InstanceRepository,
	Effect.map(DatabaseClient, (db) =>
		InstanceRepository.of({
			findById: (id) => findById(db, id),
			findBySlug: (col, slug) => findBySlug(db, col, slug),
			listByCollection: (col) => listByCollection(db, col),
			insert: (input) => insertInstance(db, input),
			updateEtag: (id, etag, rev) => updateEtag(db, id, etag, rev),
			softDelete: (id) => softDelete(db, id),
		}),
	),
);
