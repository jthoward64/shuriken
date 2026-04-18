import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { shareLink, shareLinkCalendars } from "#src/db/drizzle/schema/index.ts";
import type { ShareLinkVisibility } from "#src/db/drizzle/schema/share-link.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { UserId, UuidString } from "#src/domain/ids.ts";
import type { ShareLinkRepositoryShape } from "./repository.ts";

// ---------------------------------------------------------------------------
// ShareLinkRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const findById = Effect.fn("ShareLinkRepository.findById")(
	function* (db: DbClient, id: UuidString) {
		yield* Effect.logTrace("repo.shareLink.findById", { id });
		return yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(shareLink)
					.where(and(eq(shareLink.id, id), isNull(shareLink.deletedAt)))
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
		yield* Effect.logTrace("repo.shareLink.findByUser", { userId });
		return yield* Effect.tryPromise({
			try: () =>
				db
					.select()
					.from(shareLink)
					.where(
						and(eq(shareLink.userId, userId), isNull(shareLink.deletedAt)),
					),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.shareLink.findByUser failed", e.cause),
	),
);

const listCalendars = Effect.fn("ShareLinkRepository.listCalendars")(
	function* (db: DbClient, linkId: UuidString) {
		yield* Effect.logTrace("repo.shareLink.listCalendars", { linkId });
		return yield* Effect.tryPromise({
			try: () =>
				db
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
		input: { userId: UserId; expiresAt?: Date; enabled?: boolean },
	) {
		yield* Effect.logTrace("repo.shareLink.insert", { userId: input.userId });
		return yield* Effect.tryPromise({
			try: () =>
				db
					.insert(shareLink)
					.values({
						userId: input.userId,
						expiresAt: input.expiresAt,
						enabled: input.enabled,
					})
					.returning()
					.then((r) => {
						const row = r[0];
						if (!row) throw new Error("Insert returned no rows");
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
		input: { enabled?: boolean; expiresAt?: Date },
	) {
		yield* Effect.logTrace("repo.shareLink.update", { id });
		return yield* Effect.tryPromise({
			try: () =>
				db
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
						if (!row) throw new Error("Update returned no rows");
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
		yield* Effect.logTrace("repo.shareLink.softDelete", { id });
		return yield* Effect.tryPromise({
			try: () =>
				db
					.update(shareLink)
					.set({ deletedAt: sql`now()` })
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
		yield* Effect.logTrace("repo.shareLink.addCalendar", {
			linkId,
			calendarId,
		});
		return yield* Effect.tryPromise({
			try: () =>
				db
					.insert(shareLinkCalendars)
					.values({
						shareLinkId: linkId,
						calendarId,
						visibility,
					})
					.returning()
					.then((r) => {
						const row = r[0];
						if (!row) throw new Error("Insert returned no rows");
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
		yield* Effect.logTrace("repo.shareLink.removeCalendar", {
			linkId,
			calendarId,
		});
		return yield* Effect.tryPromise({
			try: () =>
				db
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
	Effect.gen(function* () {
		const db = yield* DatabaseClient;
		return {
			findById,
			findByUser,
			listCalendars,
			insert,
			update,
			softDelete,
			addCalendar,
			removeCalendar,
		} as ShareLinkRepositoryShape;
	}),
);
