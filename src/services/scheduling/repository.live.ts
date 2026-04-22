// ---------------------------------------------------------------------------
// SchedulingRepository — Drizzle implementation
// ---------------------------------------------------------------------------

import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import type { IrComponent } from "#src/data/ir.ts";
import { DatabaseClient } from "#src/db/client.ts";
import {
	davCollection,
	davEntity,
	davInstance,
	davScheduleMessage,
	principal,
	user,
} from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type {
	CollectionId,
	EntityId,
	InstanceId,
	PrincipalId,
} from "#src/domain/ids.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import type { PrincipalWithUser } from "#src/services/principal/repository.ts";
import { SchedulingRepository } from "./repository.ts";
import type { NewScheduleMessage } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const findPrincipalByCalAddress = Effect.fn(
	"SchedulingRepository.findPrincipalByCalAddress",
)(
	function* (calAddress: string) {
		yield* Effect.logTrace("repo.scheduling.findPrincipalByCalAddress", {
			calAddress,
		});
		const email = calAddress.toLowerCase().startsWith("mailto:")
			? calAddress.slice("mailto:".length)
			: calAddress;
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(principal)
				.innerJoin(user, eq(user.principalId, principal.id))
				.where(and(eq(user.email, email), isNull(principal.deletedAt)))
				.limit(1),
		).pipe(
			Effect.map((r) =>
				Option.fromNullable(
					r[0]
						? ({
								principal: r[0].principal,
								user: r[0].user,
							} as PrincipalWithUser)
						: null,
				),
			),
		);
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning(
			"repo.scheduling.findPrincipalByCalAddress failed",
			e.cause,
		),
	),
);

const findInbox = Effect.fn("SchedulingRepository.findInbox")(
	function* (principalId: PrincipalId) {
		yield* Effect.annotateCurrentSpan({ "principal.id": principalId });
		yield* Effect.logTrace("repo.scheduling.findInbox", { principalId });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(davCollection)
				.where(
					and(
						eq(davCollection.ownerPrincipalId, principalId),
						eq(davCollection.collectionType, "inbox"),
						isNull(davCollection.deletedAt),
					),
				)
				.limit(1),
		).pipe(
			Effect.map((r) => Option.fromNullable(r[0] as CollectionRow | undefined)),
		);
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning("repo.scheduling.findInbox failed", e.cause),
	),
);

const findDefaultCalendar = Effect.fn(
	"SchedulingRepository.findDefaultCalendar",
)(function* (principalId: PrincipalId) {
	yield* Effect.annotateCurrentSpan({ "principal.id": principalId });
	yield* Effect.logTrace("repo.scheduling.findDefaultCalendar", { principalId });
	// Step 1: get the inbox to read scheduleDefaultCalendarId
	const inbox = yield* runDbQuery((db) =>
		db
			.select({
				scheduleDefaultCalendarId: davCollection.scheduleDefaultCalendarId,
			})
			.from(davCollection)
			.where(
				and(
					eq(davCollection.ownerPrincipalId, principalId),
					eq(davCollection.collectionType, "inbox"),
					isNull(davCollection.deletedAt),
				),
			)
			.limit(1),
	).pipe(Effect.map((r) => r[0]));
	if (!inbox?.scheduleDefaultCalendarId) {
		return Option.none<CollectionRow>();
	}
	// Step 2: load the target calendar
	return yield* runDbQuery((db) =>
		db
			.select()
			.from(davCollection)
			.where(
				and(
					// biome-ignore lint/style/noNonNullAssertion: guarded by null check above
					eq(davCollection.id, inbox.scheduleDefaultCalendarId!),
					isNull(davCollection.deletedAt),
				),
			)
			.limit(1),
	).pipe(
		Effect.map((r) => Option.fromNullable(r[0] as CollectionRow | undefined)),
	);
});

const findSorByUid = Effect.fn("SchedulingRepository.findSorByUid")(
	function* (principalId: PrincipalId, uid: string) {
		yield* Effect.annotateCurrentSpan({
			"principal.id": principalId,
			"entity.logical_uid": uid,
		});
		yield* Effect.logTrace("repo.scheduling.findSorByUid", { principalId, uid });
		return yield* runDbQuery((db) =>
			db
				.select({ instance: davInstance, collection: davCollection })
				.from(davInstance)
				.innerJoin(davCollection, eq(davCollection.id, davInstance.collectionId))
				.innerJoin(davEntity, eq(davEntity.id, davInstance.entityId))
				.where(
					and(
						eq(davCollection.ownerPrincipalId, principalId),
						eq(davCollection.collectionType, "calendar"),
						eq(davEntity.logicalUid, uid),
						isNull(davInstance.deletedAt),
						isNull(davEntity.deletedAt),
						isNull(davCollection.deletedAt),
					),
				)
				.limit(1),
		).pipe(
			Effect.map((r) =>
				Option.fromNullable(
					r[0]
						? {
								instance: r[0].instance as InstanceRow,
								collection: r[0].collection as CollectionRow,
							}
						: null,
				),
			),
		);
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning("repo.scheduling.findSorByUid failed", e.cause),
	),
);

const findInboxInstance = Effect.fn("SchedulingRepository.findInboxInstance")(
	function* (inboxCollectionId: CollectionId, uid: string) {
		yield* Effect.annotateCurrentSpan({
			"collection.id": inboxCollectionId,
			"entity.logical_uid": uid,
		});
		yield* Effect.logTrace("repo.scheduling.findInboxInstance", {
			inboxCollectionId,
			uid,
		});
		return yield* runDbQuery((db) =>
			db
				.select({ instance: davInstance, entityId: davEntity.id })
				.from(davInstance)
				.innerJoin(davEntity, eq(davEntity.id, davInstance.entityId))
				.where(
					and(
						eq(davInstance.collectionId, inboxCollectionId),
						eq(davEntity.logicalUid, uid),
						isNull(davInstance.deletedAt),
						isNull(davEntity.deletedAt),
					),
				)
				.limit(1),
		).pipe(
			Effect.map((r) =>
				Option.fromNullable(
					r[0]
						? {
								instance: r[0].instance as InstanceRow,
								entityId: r[0].entityId as EntityId,
								components: [] as ReadonlyArray<IrComponent>,
							}
						: null,
				),
			),
		);
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning("repo.scheduling.findInboxInstance failed", e.cause),
	),
);

const insertScheduleMessage = Effect.fn(
	"SchedulingRepository.insertScheduleMessage",
)(
	function* (msg: NewScheduleMessage) {
		yield* Effect.annotateCurrentSpan({
			"scheduling.recipient": msg.recipient,
			"scheduling.method": msg.method,
		});
		yield* Effect.logTrace("repo.scheduling.insertScheduleMessage", {
			recipient: msg.recipient,
			method: msg.method,
		});
		return yield* runDbQuery((db) =>
			db
				.insert(davScheduleMessage)
				.values({
					collectionId: msg.collectionId,
					entityId: msg.entityId,
					sender: msg.sender,
					recipient: msg.recipient,
					method: msg.method,
					status: "pending",
				})
				.returning(),
		).pipe(
			Effect.flatMap((r) => {
				const row = r[0];
				if (!row) {
					return Effect.fail(
						new DatabaseError({
							cause: new Error("insertScheduleMessage returned no rows"),
						}),
					);
				}
				return Effect.succeed(row);
			}),
		);
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning("repo.scheduling.insertScheduleMessage failed", e.cause),
	),
);

const listOpaqueCalendarCollections = Effect.fn(
	"SchedulingRepository.listOpaqueCalendarCollections",
)(
	function* (principalId: PrincipalId) {
		yield* Effect.annotateCurrentSpan({ "principal.id": principalId });
		yield* Effect.logTrace("repo.scheduling.listOpaqueCalendarCollections", {
			principalId,
		});
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(davCollection)
				.where(
					and(
						eq(davCollection.ownerPrincipalId, principalId),
						eq(davCollection.collectionType, "calendar"),
						eq(davCollection.scheduleTransp, "opaque"),
						isNull(davCollection.deletedAt),
					),
				),
		);
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning(
			"repo.scheduling.listOpaqueCalendarCollections failed",
			e.cause,
		),
	),
);

const updateScheduleTag = Effect.fn("SchedulingRepository.updateScheduleTag")(
	function* (instanceId: InstanceId, scheduleTag: string) {
		yield* Effect.annotateCurrentSpan({ "instance.id": instanceId });
		yield* Effect.logTrace("repo.scheduling.updateScheduleTag", { instanceId });
		return yield* runDbQuery((db) =>
			db
				.update(davInstance)
				.set({ scheduleTag, updatedAt: sql`now()` })
				.where(
					and(eq(davInstance.id, instanceId), isNull(davInstance.deletedAt)),
				),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning("repo.scheduling.updateScheduleTag failed", e.cause),
	),
);

// ---------------------------------------------------------------------------
// Layer
// ---------------------------------------------------------------------------

export const SchedulingRepositoryLive = Layer.effect(
	SchedulingRepository,
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(e: Effect.Effect<A, E, DatabaseClient>): Effect.Effect<A, E> =>
			Effect.provideService(e, DatabaseClient, dc);
		return SchedulingRepository.of({
			findPrincipalByCalAddress: (...args: Parameters<typeof findPrincipalByCalAddress>) =>
				run(findPrincipalByCalAddress(...args)),
			findInbox: (...args: Parameters<typeof findInbox>) => run(findInbox(...args)),
			findDefaultCalendar: (...args: Parameters<typeof findDefaultCalendar>) =>
				run(findDefaultCalendar(...args)),
			findSorByUid: (...args: Parameters<typeof findSorByUid>) =>
				run(findSorByUid(...args)),
			findInboxInstance: (...args: Parameters<typeof findInboxInstance>) =>
				run(findInboxInstance(...args)),
			insertScheduleMessage: (...args: Parameters<typeof insertScheduleMessage>) =>
				run(insertScheduleMessage(...args)),
			updateScheduleTag: (...args: Parameters<typeof updateScheduleTag>) =>
				run(updateScheduleTag(...args)),
			listOpaqueCalendarCollections: (
				...args: Parameters<typeof listOpaqueCalendarCollections>
			) => run(listOpaqueCalendarCollections(...args)),
		});
	}),
);
