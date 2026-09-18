import {
	and,
	asc,
	eq,
	inArray,
	isNotNull,
	isNull,
	lt,
	notInArray,
	sql,
} from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import type { Temporal } from "temporal-polyfill";
import { DatabaseClient } from "#src/db/client.ts";
import {
	type CollectionType,
	davCollection,
	davInstance,
	davTombstone,
} from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
import { withTransaction } from "#src/db/transaction.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import {
	type CollectionPropertyChanges,
	CollectionRepository,
	type CollectionRow,
	type NewCollection,
} from "./repository.ts";
import { DEFAULT_SORT_ORDER } from "./sort-order.ts";

// ---------------------------------------------------------------------------
// CollectionRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const findById = Effect.fn("CollectionRepository.findById")(
	function* (id: CollectionId) {
		yield* Effect.annotateCurrentSpan({ "collection.id": id });
		yield* Effect.logTrace("repo.collection.findById", { id });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(davCollection)
				.where(and(eq(davCollection.id, id), isNull(davCollection.deletedAt)))
				.limit(1),
		).pipe(Effect.map((r) => Option.fromNullishOr(r[0])));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.findById failed", e.cause),
	),
);

const findByIds = Effect.fn("CollectionRepository.findByIds")(
	function* (ids: ReadonlyArray<CollectionId>) {
		yield* Effect.annotateCurrentSpan({ "collection.count": ids.length });
		yield* Effect.logTrace("repo.collection.findByIds", { count: ids.length });
		const map = new Map<CollectionId, CollectionRow>();
		if (ids.length === 0) {
			return map as ReadonlyMap<CollectionId, CollectionRow>;
		}
		const rows = yield* runDbQuery((db) =>
			db
				.select()
				.from(davCollection)
				.where(
					and(
						inArray(davCollection.id, ids as Array<CollectionId>),
						isNull(davCollection.deletedAt),
					),
				),
		);
		for (const row of rows) {
			map.set(row.id as CollectionId, row);
		}
		return map as ReadonlyMap<CollectionId, CollectionRow>;
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.findByIds failed", e.cause),
	),
);

const findDeletedById = Effect.fn("CollectionRepository.findDeletedById")(
	function* (id: CollectionId) {
		yield* Effect.annotateCurrentSpan({ "collection.id": id });
		yield* Effect.logTrace("repo.collection.findDeletedById", { id });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(davCollection)
				.where(
					and(eq(davCollection.id, id), isNotNull(davCollection.deletedAt)),
				)
				.limit(1),
		).pipe(Effect.map((r) => Option.fromNullishOr(r[0])));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.findDeletedById failed", e.cause),
	),
);

const findBySlug = Effect.fn("CollectionRepository.findBySlug")(
	function* (
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
		return yield* runDbQuery((db) =>
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
				.limit(1),
		).pipe(Effect.map((r) => Option.fromNullishOr(r[0])));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.findBySlug failed", e.cause),
	),
);

const listByOwner = Effect.fn("CollectionRepository.listByOwner")(
	function* (ownerPrincipalId: PrincipalId) {
		yield* Effect.annotateCurrentSpan({ "principal.id": ownerPrincipalId });
		yield* Effect.logTrace("repo.collection.listByOwner", { ownerPrincipalId });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(davCollection)
				.where(
					and(
						eq(davCollection.ownerPrincipalId, ownerPrincipalId),
						isNull(davCollection.deletedAt),
					),
				)
				.orderBy(asc(davCollection.sortOrder), asc(davCollection.id)),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.listByOwner failed", e.cause),
	),
);

const listDeletedByOwner = Effect.fn("CollectionRepository.listDeletedByOwner")(
	function* (ownerPrincipalId: PrincipalId) {
		yield* Effect.annotateCurrentSpan({ "principal.id": ownerPrincipalId });
		yield* Effect.logTrace("repo.collection.listDeletedByOwner", {
			ownerPrincipalId,
		});
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(davCollection)
				.where(
					and(
						eq(davCollection.ownerPrincipalId, ownerPrincipalId),
						isNotNull(davCollection.deletedAt),
					),
				),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.listDeletedByOwner failed", e.cause),
	),
);

const listDeletedOlderThan = Effect.fn(
	"CollectionRepository.listDeletedOlderThan",
)(
	function* (cutoff: Temporal.Instant) {
		yield* Effect.annotateCurrentSpan({ "trash.cutoff": cutoff.toString() });
		yield* Effect.logTrace("repo.collection.listDeletedOlderThan", {
			cutoff: cutoff.toString(),
		});
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(davCollection)
				.where(
					and(
						isNotNull(davCollection.deletedAt),
						lt(davCollection.deletedAt, cutoff),
					),
				),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.listDeletedOlderThan failed", e.cause),
	),
);

const listByAutoManagedKind = Effect.fn(
	"CollectionRepository.listByAutoManagedKind",
)(
	function* (kind: string) {
		yield* Effect.annotateCurrentSpan({ "collection.auto_managed_kind": kind });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(davCollection)
				.where(
					and(
						eq(davCollection.autoManagedKind, kind),
						isNull(davCollection.deletedAt),
					),
				),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.listByAutoManagedKind failed", e.cause),
	),
);

const listSharedWithPrincipals = Effect.fn(
	"CollectionRepository.listSharedWithPrincipals",
)(
	function* (
		principalIds: ReadonlyArray<PrincipalId>,
		privileges: ReadonlyArray<string>,
	) {
		yield* Effect.annotateCurrentSpan({
			"caller.principals": principalIds.length,
		});
		if (principalIds.length === 0 || privileges.length === 0) {
			return [];
		}
		// dav_acl is polymorphic on (resource_type, resource_id); inline-join to
		// dav_collection keeps the query single-pass. The `notInArray(owner...)`
		// excludes the caller's own collections — sharing-discovery only shows
		// other people's resources.
		return yield* runDbQuery((db) =>
			db
				.selectDistinct({ collection: davCollection })
				.from(davCollection)
				.innerJoin(
					sql`dav_acl`,
					sql`dav_acl.resource_id = ${davCollection.id} AND dav_acl.resource_type = 'collection'`,
				)
				.where(
					and(
						isNull(davCollection.deletedAt),
						notInArray(davCollection.ownerPrincipalId, [...principalIds]),
						sql`dav_acl.principal_type = 'principal'`,
						sql`dav_acl.grant_deny = 'grant'`,
						inArray(sql`dav_acl.principal_id`, [...principalIds]),
						inArray(sql`dav_acl.privilege`, [...privileges]),
					),
				),
		).pipe(Effect.map((rows) => rows.map((r) => r.collection)));
	},
	Effect.tapError((e) =>
		Effect.logWarning(
			"repo.collection.listSharedWithPrincipals failed",
			e.cause,
		),
	),
);

const insert = Effect.fn("CollectionRepository.insert")(
	function* (input: NewCollection) {
		yield* Effect.annotateCurrentSpan({
			"collection.owner": input.ownerPrincipalId,
			"collection.type": input.collectionType,
			"collection.slug": input.slug,
		});
		yield* Effect.logTrace("repo.collection.insert", {
			ownerPrincipalId: input.ownerPrincipalId,
			slug: input.slug,
		});
		// Type-default sort order: generated collections sit at the bottom (1000);
		// subscriptions pass 0 explicitly; everything else is a normal collection.
		const sortOrder =
			input.sortOrder ??
			(input.autoManagedKind != null
				? DEFAULT_SORT_ORDER.generated
				: DEFAULT_SORT_ORDER.normal);
		return yield* runDbQuery((db) =>
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
					autoManagedKind: input.autoManagedKind,
					scheduleDefaultCalendarId: input.scheduleDefaultCalendarId,
					sortOrder,
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
		Effect.logWarning("repo.collection.insert failed", e.cause),
	),
);

const relocate = Effect.fn("CollectionRepository.relocate")(
	function* (
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
		return yield* runDbQuery((db) =>
			db
				.update(davCollection)
				.set({
					ownerPrincipalId: targetOwnerPrincipalId,
					slug: targetSlug,
					updatedAt: sql`now()`,
				})
				.where(and(eq(davCollection.id, id), isNull(davCollection.deletedAt)))
				.returning(),
		).pipe(
			Effect.flatMap((rows) => {
				const row = rows[0];
				if (!row) {
					return Effect.fail(
						new DatabaseError({
							cause: new Error(`Collection not found for relocation: ${id}`),
						}),
					);
				}
				return Effect.succeed(row);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.relocate failed", e.cause),
	),
);

const softDelete = Effect.fn("CollectionRepository.softDelete")(
	function* (id: CollectionId) {
		yield* Effect.annotateCurrentSpan({ "collection.id": id });
		yield* Effect.logTrace("repo.collection.softDelete", { id });
		return yield* runDbQuery((db) =>
			db
				.update(davCollection)
				.set({ deletedAt: sql`now()` })
				.where(eq(davCollection.id, id))
				.returning(),
		).pipe(
			Effect.flatMap((rows) => {
				const row = rows[0];
				if (!row) {
					return Effect.fail(
						new DatabaseError({
							cause: new Error(`Collection not found for deletion: ${id}`),
						}),
					);
				}
				return Effect.succeed(row);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.softDelete failed", e.cause),
	),
);

const restore = Effect.fn("CollectionRepository.restore")(
	function* (id: CollectionId) {
		yield* Effect.annotateCurrentSpan({ "collection.id": id });
		yield* Effect.logTrace("repo.collection.restore", { id });
		return yield* runDbQuery((db) =>
			db
				.update(davCollection)
				.set({ deletedAt: null })
				.where(
					and(eq(davCollection.id, id), isNotNull(davCollection.deletedAt)),
				)
				.returning(),
		).pipe(
			Effect.flatMap((rows) => {
				const row = rows[0];
				if (!row) {
					return Effect.fail(
						new DatabaseError({
							cause: new Error(`Collection not found for restore: ${id}`),
						}),
					);
				}
				return Effect.succeed(row);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.restore failed", e.cause),
	),
);

const hardDelete = Effect.fn("CollectionRepository.hardDelete")(
	function* (id: CollectionId) {
		yield* Effect.annotateCurrentSpan({ "collection.id": id });
		yield* Effect.logTrace("repo.collection.hardDelete", { id });
		yield* withTransaction(
			Effect.gen(function* () {
				// dav_instance.collection_id and dav_tombstone.collection_id are both
				// ON DELETE RESTRICT — clear every row referencing this collection
				// first (dav_tombstone accumulates one row per soft-deleted instance
				// via the sync_token_on_instance_change trigger, so it outlives the
				// instances themselves).
				yield* runDbQuery((db) =>
					db.delete(davInstance).where(eq(davInstance.collectionId, id)),
				);
				yield* runDbQuery((db) =>
					db.delete(davTombstone).where(eq(davTombstone.collectionId, id)),
				);
				yield* runDbQuery((db) =>
					db.delete(davCollection).where(eq(davCollection.id, id)),
				);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.hardDelete failed", e.cause),
	),
);

const updateProperties = Effect.fn("CollectionRepository.updateProperties")(
	function* (id: CollectionId, changes: CollectionPropertyChanges) {
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
		if (changes.sortOrder !== undefined) {
			setValues.sortOrder = changes.sortOrder;
		}
		return yield* runDbQuery((db) =>
			db
				.update(davCollection)
				.set(setValues)
				.where(and(eq(davCollection.id, id), isNull(davCollection.deletedAt)))
				.returning(),
		).pipe(
			Effect.flatMap((rows) => {
				const row = rows[0];
				if (!row) {
					return Effect.fail(
						new DatabaseError({
							cause: new Error(
								`Collection not found for property update: ${id}`,
							),
						}),
					);
				}
				return Effect.succeed(row);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.updateProperties failed", e.cause),
	),
);

const reorder = Effect.fn("CollectionRepository.reorder")(
	function* (changes: ReadonlyMap<CollectionId, number>) {
		if (changes.size === 0) {
			return;
		}
		const ids = [...changes.keys()];
		yield* Effect.annotateCurrentSpan({
			"collection.reorder_count": ids.length,
		});
		yield* Effect.logTrace("repo.collection.reorder", { count: ids.length });
		// Single UPDATE with a CASE that maps each id to its new value.
		const cases = sql.join(
			ids.map(
				(id) => sql`WHEN ${id}::uuid THEN ${changes.get(id) ?? 0}::integer`,
			),
			sql` `,
		);
		yield* runDbQuery((db) =>
			db
				.update(davCollection)
				.set({
					sortOrder: sql`CASE ${davCollection.id} ${cases} END`,
					updatedAt: sql`now()`,
				})
				.where(
					and(inArray(davCollection.id, ids), isNull(davCollection.deletedAt)),
				),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.collection.reorder failed", e.cause),
	),
);

export const CollectionRepositoryLive = Layer.effect(
	CollectionRepository,
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(
			e: Effect.Effect<A, E, DatabaseClient>,
		): Effect.Effect<A, E> => Effect.provideService(e, DatabaseClient, dc);
		return {
			findById: (...args: Parameters<typeof findById>) =>
				run(findById(...args)),
			findByIds: (...args: Parameters<typeof findByIds>) =>
				run(findByIds(...args)),
			findDeletedById: (...args: Parameters<typeof findDeletedById>) =>
				run(findDeletedById(...args)),
			findBySlug: (...args: Parameters<typeof findBySlug>) =>
				run(findBySlug(...args)),
			listByOwner: (...args: Parameters<typeof listByOwner>) =>
				run(listByOwner(...args)),
			listDeletedByOwner: (...args: Parameters<typeof listDeletedByOwner>) =>
				run(listDeletedByOwner(...args)),
			listDeletedOlderThan: (
				...args: Parameters<typeof listDeletedOlderThan>
			) => run(listDeletedOlderThan(...args)),
			listByAutoManagedKind: (
				...args: Parameters<typeof listByAutoManagedKind>
			) => run(listByAutoManagedKind(...args)),
			listSharedWithPrincipals: (
				...args: Parameters<typeof listSharedWithPrincipals>
			) => run(listSharedWithPrincipals(...args)),
			insert: (...args: Parameters<typeof insert>) => run(insert(...args)),
			softDelete: (...args: Parameters<typeof softDelete>) =>
				run(softDelete(...args)),
			restore: (...args: Parameters<typeof restore>) => run(restore(...args)),
			hardDelete: (...args: Parameters<typeof hardDelete>) =>
				run(hardDelete(...args)),
			relocate: (...args: Parameters<typeof relocate>) =>
				run(relocate(...args)),
			updateProperties: (...args: Parameters<typeof updateProperties>) =>
				run(updateProperties(...args)),
			reorder: (...args: Parameters<typeof reorder>) => run(reorder(...args)),
		};
	}),
);
