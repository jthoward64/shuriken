import { and, eq, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import type { Temporal } from "temporal-polyfill";
import { DatabaseClient } from "#src/db/client.ts";
import { shareLink, shareLinkCalendars } from "#src/db/drizzle/schema/index.ts";
import type { ShareLinkVisibility } from "#src/db/drizzle/schema/share-link.ts";
import { runDbQuery } from "#src/db/query.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { UserId, UuidString } from "#src/domain/ids.ts";
import { ShareLinkRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// ShareLinkRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const findById = Effect.fn("ShareLinkRepository.findById")(
	function* (id: UuidString) {
		yield* Effect.annotateCurrentSpan({ "share_link.id": id });
		yield* Effect.logTrace("repo.shareLink.findById", { id });
		return yield* runDbQuery((db) =>
			db.select().from(shareLink).where(eq(shareLink.id, id)).limit(1),
		).pipe(Effect.map((r) => Option.fromNullishOr(r[0])));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.shareLink.findById failed", e.cause),
	),
);

const findByToken = Effect.fn("ShareLinkRepository.findByToken")(
	function* (token: string) {
		yield* Effect.logTrace("repo.shareLink.findByToken");
		return yield* runDbQuery((db) =>
			db.select().from(shareLink).where(eq(shareLink.token, token)).limit(1),
		).pipe(Effect.map((r) => Option.fromNullishOr(r[0])));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.shareLink.findByToken failed", e.cause),
	),
);

const findByUser = Effect.fn("ShareLinkRepository.findByUser")(
	function* (userId: UserId) {
		yield* Effect.annotateCurrentSpan({ "user.id": userId });
		yield* Effect.logTrace("repo.shareLink.findByUser", { userId });
		return yield* runDbQuery((db) =>
			db.select().from(shareLink).where(eq(shareLink.userId, userId)),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.shareLink.findByUser failed", e.cause),
	),
);

const listCalendars = Effect.fn("ShareLinkRepository.listCalendars")(
	function* (linkId: UuidString) {
		yield* Effect.annotateCurrentSpan({ "share_link.id": linkId });
		yield* Effect.logTrace("repo.shareLink.listCalendars", { linkId });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(shareLinkCalendars)
				.where(eq(shareLinkCalendars.shareLinkId, linkId)),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.shareLink.listCalendars failed", e.cause),
	),
);

const insert = Effect.fn("ShareLinkRepository.insert")(
	function* (input: {
		userId: UserId;
		token: string;
		displayName?: string | null;
		expiresAt?: Temporal.Instant | null;
		enabled?: boolean;
	}) {
		yield* Effect.annotateCurrentSpan({ "user.id": input.userId });
		yield* Effect.logTrace("repo.shareLink.insert", { userId: input.userId });
		return yield* runDbQuery((db) =>
			db
				.insert(shareLink)
				.values({
					userId: input.userId,
					token: input.token,
					displayName: input.displayName ?? null,
					expiresAt: input.expiresAt ?? null,
					enabled: input.enabled,
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
		Effect.logWarning("repo.shareLink.insert failed", e.cause),
	),
);

const update = Effect.fn("ShareLinkRepository.update")(
	function* (
		id: UuidString,
		input: {
			enabled?: boolean;
			token?: string;
			displayName?: string | null;
			expiresAt?: Temporal.Instant | null;
		},
	) {
		yield* Effect.annotateCurrentSpan({ "share_link.id": id });
		yield* Effect.logTrace("repo.shareLink.update", { id });
		// Drizzle treats `undefined` as "do not set", so we can pass the partial
		// directly; explicit `null` clears nullable columns (displayName, expiresAt).
		return yield* runDbQuery((db) =>
			db
				.update(shareLink)
				.set({
					enabled: input.enabled,
					token: input.token,
					displayName: input.displayName,
					expiresAt: input.expiresAt,
					updatedAt: sql`now()`,
				})
				.where(eq(shareLink.id, id))
				.returning(),
		).pipe(
			Effect.flatMap((r) => {
				const row = r[0];
				if (!row) {
					return Effect.fail(
						new DatabaseError({ cause: new Error("Update returned no rows") }),
					);
				}
				return Effect.succeed(row);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.shareLink.update failed", e.cause),
	),
);

const softDelete = Effect.fn("ShareLinkRepository.softDelete")(
	function* (id: UuidString) {
		yield* Effect.annotateCurrentSpan({ "share_link.id": id });
		yield* Effect.logTrace("repo.shareLink.softDelete", { id });
		return yield* runDbQuery((db) =>
			db.delete(shareLink).where(eq(shareLink.id, id)),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.shareLink.softDelete failed", e.cause),
	),
);

const addCalendar = Effect.fn("ShareLinkRepository.addCalendar")(
	function* (
		linkId: UuidString,
		calendarId: UuidString,
		visibility: ShareLinkVisibility,
		embedEnabled?: boolean,
	) {
		yield* Effect.annotateCurrentSpan({
			"share_link.id": linkId,
			"collection.id": calendarId,
		});
		yield* Effect.logTrace("repo.shareLink.addCalendar", {
			linkId,
			calendarId,
		});
		return yield* runDbQuery((db) =>
			db
				.insert(shareLinkCalendars)
				.values({
					shareLinkId: linkId,
					calendarId,
					visibility,
					embedEnabled,
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
		Effect.logWarning("repo.shareLink.addCalendar failed", e.cause),
	),
);

const setCalendarVisibility = Effect.fn(
	"ShareLinkRepository.setCalendarVisibility",
)(
	function* (
		linkId: UuidString,
		calendarId: UuidString,
		visibility: ShareLinkVisibility,
		embedEnabled?: boolean,
	) {
		yield* Effect.annotateCurrentSpan({
			"share_link.id": linkId,
			"collection.id": calendarId,
		});
		yield* Effect.logTrace("repo.shareLink.setCalendarVisibility", {
			linkId,
			calendarId,
			visibility,
		});
		return yield* runDbQuery((db) =>
			db
				.update(shareLinkCalendars)
				.set({ visibility, embedEnabled })
				.where(
					and(
						eq(shareLinkCalendars.shareLinkId, linkId),
						eq(shareLinkCalendars.calendarId, calendarId),
					),
				),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.shareLink.setCalendarVisibility failed", e.cause),
	),
);

const removeCalendar = Effect.fn("ShareLinkRepository.removeCalendar")(
	function* (linkId: UuidString, calendarId: UuidString) {
		yield* Effect.annotateCurrentSpan({
			"share_link.id": linkId,
			"collection.id": calendarId,
		});
		yield* Effect.logTrace("repo.shareLink.removeCalendar", {
			linkId,
			calendarId,
		});
		return yield* runDbQuery((db) =>
			db
				.delete(shareLinkCalendars)
				.where(
					and(
						eq(shareLinkCalendars.shareLinkId, linkId),
						eq(shareLinkCalendars.calendarId, calendarId),
					),
				),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.shareLink.removeCalendar failed", e.cause),
	),
);

export const ShareLinkRepositoryLive = Layer.effect(
	ShareLinkRepository,
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(
			e: Effect.Effect<A, E, DatabaseClient>,
		): Effect.Effect<A, E> => Effect.provideService(e, DatabaseClient, dc);
		return {
			findById: (...args: Parameters<typeof findById>) =>
				run(findById(...args)),
			findByToken: (...args: Parameters<typeof findByToken>) =>
				run(findByToken(...args)),
			findByUser: (...args: Parameters<typeof findByUser>) =>
				run(findByUser(...args)),
			listCalendars: (...args: Parameters<typeof listCalendars>) =>
				run(listCalendars(...args)),
			insert: (...args: Parameters<typeof insert>) => run(insert(...args)),
			update: (...args: Parameters<typeof update>) => run(update(...args)),
			softDelete: (...args: Parameters<typeof softDelete>) =>
				run(softDelete(...args)),
			addCalendar: (...args: Parameters<typeof addCalendar>) =>
				run(addCalendar(...args)),
			setCalendarVisibility: (
				...args: Parameters<typeof setCalendarVisibility>
			) => run(setCalendarVisibility(...args)),
			removeCalendar: (...args: Parameters<typeof removeCalendar>) =>
				run(removeCalendar(...args)),
		};
	}),
);
