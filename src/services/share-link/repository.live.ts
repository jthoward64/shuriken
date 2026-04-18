import { and, eq, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import type { Temporal } from "temporal-polyfill";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { shareLink, shareLinkCalendars } from "#src/db/drizzle/schema/index.ts";
import type { ShareLinkVisibility } from "#src/db/drizzle/schema/share-link.ts";
import { getActiveDb } from "#src/db/transaction.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { UserId, UuidString } from "#src/domain/ids.ts";
import { ShareLinkRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// ShareLinkRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const findById = Effect.fn("ShareLinkRepository.findById")(
	function* (db: DbClient, id: UuidString) {
		yield* Effect.annotateCurrentSpan({ "share_link.id": id });
		yield* Effect.logTrace("repo.shareLink.findById", { id });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.select()
					.from(shareLink)
					.where(eq(shareLink.id, id))
					.limit(1)
					.then((r) => Option.fromNullable(r[0])),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.shareLink.findById failed", e.cause),
	),
);

const findByUser = Effect.fn("ShareLinkRepository.findByUser")(
	function* (db: DbClient, userId: UserId) {
		yield* Effect.annotateCurrentSpan({ "user.id": userId });
		yield* Effect.logTrace("repo.shareLink.findByUser", { userId });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb.select().from(shareLink).where(eq(shareLink.userId, userId)),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.shareLink.findByUser failed", e.cause),
	),
);

const listCalendars = Effect.fn("ShareLinkRepository.listCalendars")(
	function* (db: DbClient, linkId: UuidString) {
		yield* Effect.annotateCurrentSpan({ "share_link.id": linkId });
		yield* Effect.logTrace("repo.shareLink.listCalendars", { linkId });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.select()
					.from(shareLinkCalendars)
					.where(eq(shareLinkCalendars.shareLinkId, linkId)),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.shareLink.listCalendars failed", e.cause),
	),
);

const insert = Effect.fn("ShareLinkRepository.insert")(
	function* (
		db: DbClient,
		input: { userId: UserId; expiresAt?: Temporal.Instant; enabled?: boolean },
	) {
		yield* Effect.annotateCurrentSpan({ "user.id": input.userId });
		yield* Effect.logTrace("repo.shareLink.insert", { userId: input.userId });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.insert(shareLink)
					.values({
						userId: input.userId,
						expiresAt: input.expiresAt,
						enabled: input.enabled,
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
		Effect.logWarning("repo.shareLink.insert failed", e.cause),
	),
);

const update = Effect.fn("ShareLinkRepository.update")(
	function* (
		db: DbClient,
		id: UuidString,
		input: { enabled?: boolean; expiresAt?: Temporal.Instant },
	) {
		yield* Effect.annotateCurrentSpan({ "share_link.id": id });
		yield* Effect.logTrace("repo.shareLink.update", { id });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.update(shareLink)
					.set({
						enabled: input.enabled,
						expiresAt: input.expiresAt,
						updatedAt: sql`now()`,
					})
					.where(eq(shareLink.id, id))
					.returning()
					.then((r) => {
						const row = r[0];
						if (!row) {
							throw new Error("Update returned no rows");
						}
						return row;
					}),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.shareLink.update failed", e.cause),
	),
);

const softDelete = Effect.fn("ShareLinkRepository.softDelete")(
	function* (db: DbClient, id: UuidString) {
		yield* Effect.annotateCurrentSpan({ "share_link.id": id });
		yield* Effect.logTrace("repo.shareLink.softDelete", { id });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.delete(shareLink)
					.where(eq(shareLink.id, id))
					.then(() => undefined),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.shareLink.softDelete failed", e.cause),
	),
);

const addCalendar = Effect.fn("ShareLinkRepository.addCalendar")(
	function* (
		db: DbClient,
		linkId: UuidString,
		calendarId: UuidString,
		visibility: ShareLinkVisibility,
	) {
		yield* Effect.annotateCurrentSpan({
			"share_link.id": linkId,
			"collection.id": calendarId,
		});
		yield* Effect.logTrace("repo.shareLink.addCalendar", {
			linkId,
			calendarId,
		});
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.insert(shareLinkCalendars)
					.values({
						shareLinkId: linkId,
						calendarId,
						visibility,
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
		Effect.logWarning("repo.shareLink.addCalendar failed", e.cause),
	),
);

const removeCalendar = Effect.fn("ShareLinkRepository.removeCalendar")(
	function* (db: DbClient, linkId: UuidString, calendarId: UuidString) {
		yield* Effect.annotateCurrentSpan({
			"share_link.id": linkId,
			"collection.id": calendarId,
		});
		yield* Effect.logTrace("repo.shareLink.removeCalendar", {
			linkId,
			calendarId,
		});
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.delete(shareLinkCalendars)
					.where(
						and(
							eq(shareLinkCalendars.shareLinkId, linkId),
							eq(shareLinkCalendars.calendarId, calendarId),
						),
					)
					.then(() => undefined),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.shareLink.removeCalendar failed", e.cause),
	),
);

export const ShareLinkRepositoryLive = Layer.effect(
	ShareLinkRepository,
	Effect.map(DatabaseClient, (db) =>
		ShareLinkRepository.of({
			findById: (id) => findById(db, id),
			findByUser: (userId) => findByUser(db, userId),
			listCalendars: (linkId) => listCalendars(db, linkId),
			insert: (input) => insert(db, input),
			update: (id, input) => update(db, id, input),
			softDelete: (id) => softDelete(db, id),
			addCalendar: (linkId, calendarId, visibility) =>
				addCalendar(db, linkId, calendarId, visibility),
			removeCalendar: (linkId, calendarId) =>
				removeCalendar(db, linkId, calendarId),
		}),
	),
);
