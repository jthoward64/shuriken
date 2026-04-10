// ---------------------------------------------------------------------------
// SchedulingRepository — Drizzle implementation
// ---------------------------------------------------------------------------

import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import type { IrComponent } from "#src/data/ir.ts";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import {
	davCollection,
	davEntity,
	davInstance,
	davScheduleMessage,
	principal,
	user,
} from "#src/db/drizzle/schema/index.ts";
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
	function* (db: DbClient, calAddress: string) {
		yield* Effect.logTrace("repo.scheduling.findPrincipalByCalAddress", {
			calAddress,
		});
		const email = calAddress.toLowerCase().startsWith("mailto:")
			? calAddress.slice("mailto:".length)
			: calAddress;
		return yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(principal)
					.innerJoin(user, eq(user.principalId, principal.id))
					.where(and(eq(user.email, email), isNull(principal.deletedAt)))
					.limit(1)
					.then((r) =>
						Option.fromNullable(
							r[0]
								? ({
										principal: r[0].principal,
										user: r[0].user,
									} as PrincipalWithUser)
								: null,
						),
					),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning(
			"repo.scheduling.findPrincipalByCalAddress failed",
			e.cause,
		),
	),
);

const findInbox = Effect.fn("SchedulingRepository.findInbox")(
	function* (db: DbClient, principalId: PrincipalId) {
		yield* Effect.logTrace("repo.scheduling.findInbox", { principalId });
		return yield* Effect.tryPromise({
			try: () =>
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
					.limit(1)
					.then((r) => Option.fromNullable(r[0] as CollectionRow | undefined)),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning("repo.scheduling.findInbox failed", e.cause),
	),
);

const findDefaultCalendar = Effect.fn(
	"SchedulingRepository.findDefaultCalendar",
)(function* (db: DbClient, principalId: PrincipalId) {
	yield* Effect.logTrace("repo.scheduling.findDefaultCalendar", {
		principalId,
	});
	// Step 1: get the inbox to read scheduleDefaultCalendarId
	const inbox = yield* Effect.tryPromise({
		try: () =>
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
				.limit(1)
				.then((r) => r[0]),
		catch: (e) => new DatabaseError({ cause: e }),
	});
	if (!inbox?.scheduleDefaultCalendarId) {
		return Option.none<CollectionRow>();
	}
	// Step 2: load the target calendar
	return yield* Effect.tryPromise({
		try: () =>
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
				.limit(1)
				.then((r) => Option.fromNullable(r[0] as CollectionRow | undefined)),
		catch: (e) => new DatabaseError({ cause: e }),
	});
});

const findSorByUid = Effect.fn("SchedulingRepository.findSorByUid")(
	function* (db: DbClient, principalId: PrincipalId, uid: string) {
		yield* Effect.logTrace("repo.scheduling.findSorByUid", {
			principalId,
			uid,
		});
		return yield* Effect.tryPromise({
			try: () =>
				db
					.select({ instance: davInstance, collection: davCollection })
					.from(davInstance)
					.innerJoin(
						davCollection,
						eq(davCollection.id, davInstance.collectionId),
					)
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
					.limit(1)
					.then((r) =>
						Option.fromNullable(
							r[0]
								? {
										instance: r[0].instance as InstanceRow,
										collection: r[0].collection as CollectionRow,
									}
								: null,
						),
					),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning("repo.scheduling.findSorByUid failed", e.cause),
	),
);

const findInboxInstance = Effect.fn("SchedulingRepository.findInboxInstance")(
	function* (db: DbClient, inboxCollectionId: CollectionId, uid: string) {
		yield* Effect.logTrace("repo.scheduling.findInboxInstance", {
			inboxCollectionId,
			uid,
		});
		return yield* Effect.tryPromise({
			try: () =>
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
					.limit(1)
					.then((r) =>
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
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning("repo.scheduling.findInboxInstance failed", e.cause),
	),
);

const insertScheduleMessage = Effect.fn(
	"SchedulingRepository.insertScheduleMessage",
)(
	function* (db: DbClient, msg: NewScheduleMessage) {
		yield* Effect.logTrace("repo.scheduling.insertScheduleMessage", {
			recipient: msg.recipient,
			method: msg.method,
		});
		return yield* Effect.tryPromise({
			try: () =>
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
					.returning()
					.then((r) => {
						const row = r[0];
						if (!row) {
							throw new Error("insertScheduleMessage returned no rows");
						}
						return row;
					}),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning("repo.scheduling.insertScheduleMessage failed", e.cause),
	),
);

const listOpaqueCalendarCollections = Effect.fn(
	"SchedulingRepository.listOpaqueCalendarCollections",
)(
	function* (db: DbClient, principalId: PrincipalId) {
		yield* Effect.logTrace("repo.scheduling.listOpaqueCalendarCollections", {
			principalId,
		});
		return yield* Effect.tryPromise({
			try: () =>
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
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e: DatabaseError) =>
		Effect.logWarning(
			"repo.scheduling.listOpaqueCalendarCollections failed",
			e.cause,
		),
	),
);

const updateScheduleTag = Effect.fn("SchedulingRepository.updateScheduleTag")(
	function* (db: DbClient, instanceId: InstanceId, scheduleTag: string) {
		yield* Effect.logTrace("repo.scheduling.updateScheduleTag", { instanceId });
		return yield* Effect.tryPromise({
			try: () =>
				db
					.update(davInstance)
					.set({ scheduleTag, updatedAt: sql`now()` })
					.where(
						and(eq(davInstance.id, instanceId), isNull(davInstance.deletedAt)),
					)
					.then(() => undefined),
			catch: (e) => new DatabaseError({ cause: e }),
		});
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
	Effect.map(DatabaseClient, (db) =>
		SchedulingRepository.of({
			findPrincipalByCalAddress: (addr) => findPrincipalByCalAddress(db, addr),
			findInbox: (pid) => findInbox(db, pid),
			findDefaultCalendar: (pid) => findDefaultCalendar(db, pid),
			findSorByUid: (pid, uid) => findSorByUid(db, pid, uid),
			findInboxInstance: (cid, uid) => findInboxInstance(db, cid, uid),
			insertScheduleMessage: (msg) => insertScheduleMessage(db, msg),
			updateScheduleTag: (id, tag) => updateScheduleTag(db, id, tag),
			listOpaqueCalendarCollections: (pid) =>
				listOpaqueCalendarCollections(db, pid),
		}),
	),
);
