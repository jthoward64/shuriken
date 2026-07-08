import {
	and,
	eq,
	gt,
	inArray,
	isNotNull,
	isNull,
	lt,
	notInArray,
	sql,
} from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import type { Temporal } from "temporal-polyfill";
import type { IrDeadProperties } from "#src/data/ir.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { davCollection, davInstance } from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type {
	CollectionId,
	EntityId,
	InstanceId,
	PrincipalId,
} from "#src/domain/ids.ts";
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
		).pipe(Effect.map((r) => Option.fromNullishOr(r[0])));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.findById failed", e.cause),
	),
);

const findDeletedById = Effect.fn("InstanceRepository.findDeletedById")(
	function* (id: InstanceId) {
		yield* Effect.annotateCurrentSpan({ "instance.id": id });
		yield* Effect.logTrace("repo.instance.findDeletedById", { id });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(davInstance)
				.where(and(eq(davInstance.id, id), isNotNull(davInstance.deletedAt)))
				.limit(1),
		).pipe(Effect.map((r) => Option.fromNullishOr(r[0])));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.findDeletedById failed", e.cause),
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
		).pipe(Effect.map((r) => Option.fromNullishOr(r[0])));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.findBySlug failed", e.cause),
	),
);

const listSharedWithPrincipals = Effect.fn(
	"InstanceRepository.listSharedWithPrincipals",
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
		return yield* runDbQuery((db) =>
			db
				.selectDistinct({ instance: davInstance })
				.from(davInstance)
				.innerJoin(
					davCollection,
					eq(davCollection.id, davInstance.collectionId),
				)
				.innerJoin(
					sql`dav_acl`,
					sql`dav_acl.resource_id = ${davInstance.id} AND dav_acl.resource_type = 'instance'`,
				)
				.where(
					and(
						isNull(davInstance.deletedAt),
						isNull(davCollection.deletedAt),
						notInArray(davCollection.ownerPrincipalId, [...principalIds]),
						sql`dav_acl.principal_type = 'principal'`,
						sql`dav_acl.grant_deny = 'grant'`,
						inArray(sql`dav_acl.principal_id`, [...principalIds]),
						inArray(sql`dav_acl.privilege`, [...privileges]),
					),
				),
		).pipe(Effect.map((rows) => rows.map((r) => r.instance)));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.listSharedWithPrincipals failed", e.cause),
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

const listDeletedByCollection = Effect.fn(
	"InstanceRepository.listDeletedByCollection",
)(
	function* (collectionId: CollectionId) {
		yield* Effect.annotateCurrentSpan({ "collection.id": collectionId });
		yield* Effect.logTrace("repo.instance.listDeletedByCollection", {
			collectionId,
		});
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(davInstance)
				.where(
					and(
						eq(davInstance.collectionId, collectionId),
						isNotNull(davInstance.deletedAt),
					),
				),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.listDeletedByCollection failed", e.cause),
	),
);

const listDeletedOlderThan = Effect.fn(
	"InstanceRepository.listDeletedOlderThan",
)(
	function* (cutoff: Temporal.Instant) {
		yield* Effect.annotateCurrentSpan({ "trash.cutoff": cutoff.toString() });
		yield* Effect.logTrace("repo.instance.listDeletedOlderThan", {
			cutoff: cutoff.toString(),
		});
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(davInstance)
				.where(
					and(
						isNotNull(davInstance.deletedAt),
						lt(davInstance.deletedAt, cutoff),
					),
				),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.listDeletedOlderThan failed", e.cause),
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

const restore = Effect.fn("InstanceRepository.restore")(
	function* (id: InstanceId) {
		yield* Effect.annotateCurrentSpan({ "instance.id": id });
		yield* Effect.logTrace("repo.instance.restore", { id });
		return yield* runDbQuery((db) =>
			db
				.update(davInstance)
				.set({ deletedAt: null })
				.where(and(eq(davInstance.id, id), isNotNull(davInstance.deletedAt)))
				.returning(),
		).pipe(
			Effect.flatMap((rows) => {
				const row = rows[0];
				if (!row) {
					return Effect.fail(
						new DatabaseError({
							cause: new Error(`Instance not found for restore: ${id}`),
						}),
					);
				}
				return Effect.succeed(row);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.restore failed", e.cause),
	),
);

const hardDelete = Effect.fn("InstanceRepository.hardDelete")(
	function* (id: InstanceId) {
		yield* Effect.annotateCurrentSpan({ "instance.id": id });
		yield* Effect.logTrace("repo.instance.hardDelete", { id });
		return yield* runDbQuery((db) =>
			db.delete(davInstance).where(eq(davInstance.id, id)),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.instance.hardDelete failed", e.cause),
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
		return {
			findById: (...args: Parameters<typeof findById>) =>
				run(findById(...args)),
			findDeletedById: (...args: Parameters<typeof findDeletedById>) =>
				run(findDeletedById(...args)),
			findBySlug: (...args: Parameters<typeof findBySlug>) =>
				run(findBySlug(...args)),
			listSharedWithPrincipals: (
				...args: Parameters<typeof listSharedWithPrincipals>
			) => run(listSharedWithPrincipals(...args)),
			listByCollection: (...args: Parameters<typeof listByCollection>) =>
				run(listByCollection(...args)),
			listDeletedByCollection: (
				...args: Parameters<typeof listDeletedByCollection>
			) => run(listDeletedByCollection(...args)),
			listDeletedOlderThan: (
				...args: Parameters<typeof listDeletedOlderThan>
			) => run(listDeletedOlderThan(...args)),
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
			restore: (...args: Parameters<typeof restore>) => run(restore(...args)),
			hardDelete: (...args: Parameters<typeof hardDelete>) =>
				run(hardDelete(...args)),
			relocate: (...args: Parameters<typeof relocate>) =>
				run(relocate(...args)),
			updateClientProperties: (
				...args: Parameters<typeof updateClientProperties>
			) => run(updateClientProperties(...args)),
		};
	}),
);
