import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import {
	type CollectionType,
	davCollection,
} from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import {
	type CollectionPropertyChanges,
	CollectionRepository,
	type NewCollection,
} from "./repository.ts";

// ---------------------------------------------------------------------------
// CollectionRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const findById = Effect.fn("CollectionRepository.findById")(
	function* (db: DbClient, id: CollectionId) {
		yield* Effect.annotateCurrentSpan({ "collection.id": id });
		yield* Effect.logTrace("repo.collection.findById", { id });
		return yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(davCollection)
					.where(and(eq(davCollection.id, id), isNull(davCollection.deletedAt)))
					.limit(1)
					.then((r) => Option.fromNullable(r[0])),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.findById failed", e.cause),
	),
);

const findBySlug = Effect.fn("CollectionRepository.findBySlug")(
	function* (
		db: DbClient,
		ownerPrincipalId: PrincipalId,
		collectionType: CollectionType,
		slug: Slug,
	) {
		yield* Effect.annotateCurrentSpan({
			"collection.owner": ownerPrincipalId,
			"collection.type": collectionType,
			"collection.slug": slug,
		});
		yield* Effect.logTrace("repo.collection.findBySlug", {
			ownerPrincipalId,
			collectionType,
			slug,
		});
		return yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(davCollection)
					.where(
						and(
							eq(davCollection.ownerPrincipalId, ownerPrincipalId),
							eq(davCollection.collectionType, collectionType),
							eq(davCollection.slug, slug),
							isNull(davCollection.deletedAt),
						),
					)
					.limit(1)
					.then((r) => Option.fromNullable(r[0])),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.findBySlug failed", e.cause),
	),
);

const listByOwner = Effect.fn("CollectionRepository.listByOwner")(
	function* (db: DbClient, ownerPrincipalId: PrincipalId) {
		yield* Effect.annotateCurrentSpan({ "principal.id": ownerPrincipalId });
		yield* Effect.logTrace("repo.collection.listByOwner", { ownerPrincipalId });
		return yield* Effect.tryPromise({
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
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.listByOwner failed", e.cause),
	),
);

const insert = Effect.fn("CollectionRepository.insert")(
	function* (db: DbClient, input: NewCollection) {
		yield* Effect.annotateCurrentSpan({
			"collection.owner": input.ownerPrincipalId,
			"collection.type": input.collectionType,
			"collection.slug": input.slug,
		});
		yield* Effect.logTrace("repo.collection.insert", {
			ownerPrincipalId: input.ownerPrincipalId,
			slug: input.slug,
		});
		return yield* Effect.tryPromise({
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
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.insert failed", e.cause),
	),
);

const relocate = Effect.fn("CollectionRepository.relocate")(
	function* (
		db: DbClient,
		id: CollectionId,
		targetOwnerPrincipalId: PrincipalId,
		targetSlug: Slug,
	) {
		yield* Effect.annotateCurrentSpan({
			"collection.id": id,
			"collection.target_owner": targetOwnerPrincipalId,
			"collection.target_slug": targetSlug,
		});
		yield* Effect.logTrace("repo.collection.relocate", {
			id,
			targetOwnerPrincipalId,
			targetSlug,
		});
		return yield* Effect.tryPromise({
			try: () =>
				db
					.update(davCollection)
					.set({
						ownerPrincipalId: targetOwnerPrincipalId,
						slug: targetSlug,
						updatedAt: sql`now()`,
					})
					.where(and(eq(davCollection.id, id), isNull(davCollection.deletedAt)))
					.returning()
					.then((rows) => {
						const row = rows[0];
						if (!row) {
							throw new Error(`Collection not found for relocation: ${id}`);
						}
						return row;
					}),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.relocate failed", e.cause),
	),
);

const softDelete = Effect.fn("CollectionRepository.softDelete")(
	function* (db: DbClient, id: CollectionId) {
		yield* Effect.annotateCurrentSpan({ "collection.id": id });
		yield* Effect.logTrace("repo.collection.softDelete", { id });
		return yield* Effect.tryPromise({
			try: () =>
				db
					.update(davCollection)
					.set({ deletedAt: sql`now()` })
					.where(eq(davCollection.id, id))
					.returning()
					.then((rows) => {
						const row = rows[0];
						if (!row) {
							throw new Error(`Collection not found for deletion: ${id}`);
						}
						return row;
					}),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.softDelete failed", e.cause),
	),
);

const updateProperties = Effect.fn("CollectionRepository.updateProperties")(
	function* (
		db: DbClient,
		id: CollectionId,
		changes: CollectionPropertyChanges,
	) {
		yield* Effect.annotateCurrentSpan({ "collection.id": id });
		yield* Effect.logTrace("repo.collection.updateProperties", { id });
		const setValues: Record<string, unknown> = {
			clientProperties: changes.clientProperties,
			updatedAt: sql`now()`,
		};
		if (changes.displayName !== undefined) {
			setValues.displayName = changes.displayName;
		}
		if (changes.description !== undefined) {
			setValues.description = changes.description;
		}
		if (changes.timezoneTzid !== undefined) {
			setValues.timezoneTzid = changes.timezoneTzid;
		}
		if (changes.scheduleTransp !== undefined) {
			setValues.scheduleTransp = changes.scheduleTransp ?? "opaque";
		}
		if (changes.scheduleDefaultCalendarId !== undefined) {
			setValues.scheduleDefaultCalendarId = changes.scheduleDefaultCalendarId;
		}
		return yield* Effect.tryPromise({
			try: () =>
				db
					.update(davCollection)
					.set(setValues)
					.where(and(eq(davCollection.id, id), isNull(davCollection.deletedAt)))
					.returning()
					.then((rows) => {
						const row = rows[0];
						if (!row) {
							throw new Error(
								`Collection not found for property update: ${id}`,
							);
						}
						return row;
					}),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.updateProperties failed", e.cause),
	),
);

export const CollectionRepositoryLive = Layer.effect(
	CollectionRepository,
	Effect.map(DatabaseClient, (db) =>
		CollectionRepository.of({
			findById: (id) => findById(db, id),
			findBySlug: (owner, collectionType, slug) =>
				findBySlug(db, owner, collectionType, slug),
			listByOwner: (owner) => listByOwner(db, owner),
			insert: (input) => insert(db, input),
			softDelete: (id) => softDelete(db, id),
			relocate: (id, owner, slug) => relocate(db, id, owner, slug),
			updateProperties: (id, changes) => updateProperties(db, id, changes),
		}),
	),
);
