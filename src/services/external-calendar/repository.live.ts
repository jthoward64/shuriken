import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import type { Temporal } from "temporal-polyfill";
import { DatabaseClient } from "#src/db/client.ts";
import {
	davCollection,
	externalCalendar,
	externalCalendarClaim,
} from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId, UuidString } from "#src/domain/ids.ts";
import {
	ExternalCalendarRepository,
	type SyncResultPatch,
} from "./repository.ts";

const findById = Effect.fn("ExternalCalendarRepository.findById")(
	function* (id: UuidString) {
		yield* Effect.annotateCurrentSpan({ "external_calendar.id": id });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(externalCalendar)
				.where(
					and(eq(externalCalendar.id, id), isNull(externalCalendar.deletedAt)),
				)
				.limit(1),
		).pipe(Effect.map((r) => Option.fromNullishOr(r[0])));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.externalCalendar.findById failed", e.cause),
	),
);

const findByUrl = Effect.fn("ExternalCalendarRepository.findByUrl")(
	function* (url: string) {
		yield* Effect.annotateCurrentSpan({ "external_calendar.url": url });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(externalCalendar)
				.where(
					and(
						eq(externalCalendar.url, url),
						isNull(externalCalendar.deletedAt),
					),
				)
				.limit(1),
		).pipe(Effect.map((r) => Option.fromNullishOr(r[0])));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.externalCalendar.findByUrl failed", e.cause),
	),
);

/**
 * Find-or-insert the external_calendar row for `url`. Race-tolerant: if two
 * callers insert at once one wins and the other observes the winner via the
 * follow-up SELECT. We can't use `onConflictDoNothing` directly because the
 * uniqueness constraint is a partial index (`where deleted_at is null`).
 */
const upsertByUrl = Effect.fn("ExternalCalendarRepository.upsertByUrl")(
	function* (input: { url: string; syncIntervalS: number }) {
		yield* Effect.annotateCurrentSpan({
			"external_calendar.url": input.url,
		});
		const existing = yield* runDbQuery((db) =>
			db
				.select()
				.from(externalCalendar)
				.where(
					and(
						eq(externalCalendar.url, input.url),
						isNull(externalCalendar.deletedAt),
					),
				)
				.limit(1),
		);
		if (existing[0]) {
			return existing[0];
		}
		const inserted = yield* runDbQuery((db) =>
			db
				.insert(externalCalendar)
				.values({ url: input.url, syncIntervalS: input.syncIntervalS })
				.returning(),
		);
		const row = inserted[0];
		if (!row) {
			// Race: another transaction won. Re-select.
			const winner = yield* runDbQuery((db) =>
				db
					.select()
					.from(externalCalendar)
					.where(
						and(
							eq(externalCalendar.url, input.url),
							isNull(externalCalendar.deletedAt),
						),
					)
					.limit(1),
			);
			if (winner[0]) {
				return winner[0];
			}
			return yield* Effect.fail(
				new DatabaseError({
					cause: new Error("upsertByUrl returned no rows"),
				}),
			);
		}
		return row;
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.externalCalendar.upsertByUrl failed", e.cause),
	),
);

const softDelete = Effect.fn("ExternalCalendarRepository.softDelete")(
	function* (id: UuidString) {
		yield* Effect.annotateCurrentSpan({ "external_calendar.id": id });
		yield* runDbQuery((db) =>
			db
				.update(externalCalendar)
				.set({ deletedAt: sql`now()` })
				.where(eq(externalCalendar.id, id)),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.externalCalendar.softDelete failed", e.cause),
	),
);

const recordSyncResult = Effect.fn(
	"ExternalCalendarRepository.recordSyncResult",
)(
	function* (id: UuidString, patch: SyncResultPatch) {
		yield* Effect.annotateCurrentSpan({ "external_calendar.id": id });
		yield* runDbQuery((db) =>
			db
				.update(externalCalendar)
				.set({
					lastSyncStatus: patch.lastSyncStatus,
					lastSyncAt: patch.lastSyncAt,
					...(patch.fetchedAt !== undefined
						? { fetchedAt: patch.fetchedAt }
						: {}),
					...(patch.lastSyncError !== undefined
						? { lastSyncError: patch.lastSyncError }
						: {}),
					...(patch.httpEtag !== undefined ? { httpEtag: patch.httpEtag } : {}),
					...(patch.httpLastModified !== undefined
						? { httpLastModified: patch.httpLastModified }
						: {}),
					...(patch.defaultDisplayname !== undefined
						? { defaultDisplayname: patch.defaultDisplayname }
						: {}),
					...(patch.defaultColor !== undefined
						? { defaultColor: patch.defaultColor }
						: {}),
				})
				.where(eq(externalCalendar.id, id)),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.externalCalendar.recordSyncResult failed", e.cause),
	),
);

const recomputeSyncInterval = Effect.fn(
	"ExternalCalendarRepository.recomputeSyncInterval",
)(
	function* (id: UuidString) {
		yield* Effect.annotateCurrentSpan({ "external_calendar.id": id });
		// MIN over all this row's claims. If there are no claims, leave the
		// interval untouched — caller should soft-delete the row instead.
		yield* runDbQuery((db) =>
			db
				.update(externalCalendar)
				.set({
					syncIntervalS: sql<number>`coalesce(
				(select min(sync_interval_s) from external_calendar_claim
				 where external_calendar_id = ${id}),
				${externalCalendar.syncIntervalS}
			)`,
				})
				.where(eq(externalCalendar.id, id)),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning(
			"repo.externalCalendar.recomputeSyncInterval failed",
			e.cause,
		),
	),
);

const findDue = Effect.fn("ExternalCalendarRepository.findDue")(
	function* (now: Temporal.Instant) {
		yield* Effect.annotateCurrentSpan({ now: now.toString() });
		// `last_sync_at IS NULL OR last_sync_at + sync_interval_s * interval '1 sec' < now`
		// PG `make_interval(secs => x)` is the idiomatic way; we use a literal.
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(externalCalendar)
				.where(
					and(
						isNull(externalCalendar.deletedAt),
						or(
							isNull(externalCalendar.lastSyncAt),
							lt(
								sql`${externalCalendar.lastSyncAt} + make_interval(secs => ${externalCalendar.syncIntervalS})`,
								sql`${now.toString()}::timestamptz`,
							),
						),
					),
				),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.externalCalendar.findDue failed", e.cause),
	),
);

const findClaimById = Effect.fn("ExternalCalendarRepository.findClaimById")(
	function* (id: UuidString) {
		yield* Effect.annotateCurrentSpan({ "claim.id": id });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(externalCalendarClaim)
				.where(eq(externalCalendarClaim.id, id))
				.limit(1),
		).pipe(Effect.map((r) => Option.fromNullishOr(r[0])));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.externalCalendar.findClaimById failed", e.cause),
	),
);

const findClaimByCollection = Effect.fn(
	"ExternalCalendarRepository.findClaimByCollection",
)(
	function* (collectionId: CollectionId) {
		yield* Effect.annotateCurrentSpan({ "collection.id": collectionId });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(externalCalendarClaim)
				.where(eq(externalCalendarClaim.collectionId, collectionId))
				.limit(1),
		).pipe(Effect.map((r) => Option.fromNullishOr(r[0])));
	},
	Effect.tapError((e) =>
		Effect.logWarning(
			"repo.externalCalendar.findClaimByCollection failed",
			e.cause,
		),
	),
);

const listClaimsForExternal = Effect.fn(
	"ExternalCalendarRepository.listClaimsForExternal",
)(
	function* (externalCalendarId: UuidString) {
		yield* Effect.annotateCurrentSpan({
			"external_calendar.id": externalCalendarId,
		});
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(externalCalendarClaim)
				.where(
					eq(externalCalendarClaim.externalCalendarId, externalCalendarId),
				),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning(
			"repo.externalCalendar.listClaimsForExternal failed",
			e.cause,
		),
	),
);

const listClaimsWithExternalForPrincipal = Effect.fn(
	"ExternalCalendarRepository.listClaimsWithExternalForPrincipal",
)(
	function* (principalId: PrincipalId) {
		yield* Effect.annotateCurrentSpan({ "principal.id": principalId });
		const rows = yield* runDbQuery((db) =>
			db
				.select({
					claim: externalCalendarClaim,
					external: externalCalendar,
				})
				.from(externalCalendarClaim)
				.innerJoin(
					davCollection,
					eq(externalCalendarClaim.collectionId, davCollection.id),
				)
				.innerJoin(
					externalCalendar,
					eq(externalCalendarClaim.externalCalendarId, externalCalendar.id),
				)
				.where(
					and(
						eq(davCollection.ownerPrincipalId, principalId),
						isNull(davCollection.deletedAt),
						isNull(externalCalendar.deletedAt),
					),
				),
		);
		return rows;
	},
	Effect.tapError((e) =>
		Effect.logWarning(
			"repo.externalCalendar.listClaimsWithExternalForPrincipal failed",
			e.cause,
		),
	),
);

const countClaimsForExternal = Effect.fn(
	"ExternalCalendarRepository.countClaimsForExternal",
)(
	function* (externalCalendarId: UuidString) {
		yield* Effect.annotateCurrentSpan({
			"external_calendar.id": externalCalendarId,
		});
		const r = yield* runDbQuery((db) =>
			db
				.select({ n: sql<number>`count(*)::int` })
				.from(externalCalendarClaim)
				.where(
					eq(externalCalendarClaim.externalCalendarId, externalCalendarId),
				),
		);
		return r[0]?.n ?? 0;
	},
	Effect.tapError((e) =>
		Effect.logWarning(
			"repo.externalCalendar.countClaimsForExternal failed",
			e.cause,
		),
	),
);

const insertClaim = Effect.fn("ExternalCalendarRepository.insertClaim")(
	function* (input: {
		externalCalendarId: UuidString;
		collectionId: CollectionId;
		syncIntervalS: number;
		colorOverride?: string;
		displaynameOverride?: string;
	}) {
		yield* Effect.annotateCurrentSpan({
			"external_calendar.id": input.externalCalendarId,
			"collection.id": input.collectionId,
		});
		return yield* runDbQuery((db) =>
			db
				.insert(externalCalendarClaim)
				.values({
					externalCalendarId: input.externalCalendarId,
					collectionId: input.collectionId,
					syncIntervalS: input.syncIntervalS,
					colorOverride: input.colorOverride,
					displaynameOverride: input.displaynameOverride,
				})
				.returning(),
		).pipe(
			Effect.flatMap((r) => {
				const row = r[0];
				if (!row) {
					return Effect.fail(
						new DatabaseError({
							cause: new Error("insertClaim returned no rows"),
						}),
					);
				}
				return Effect.succeed(row);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.externalCalendar.insertClaim failed", e.cause),
	),
);

const updateClaim = Effect.fn("ExternalCalendarRepository.updateClaim")(
	function* (
		id: UuidString,
		patch: {
			syncIntervalS?: number;
			colorOverride?: string | null;
			displaynameOverride?: string | null;
		},
	) {
		yield* Effect.annotateCurrentSpan({ "claim.id": id });
		return yield* runDbQuery((db) =>
			db
				.update(externalCalendarClaim)
				.set({
					...(patch.syncIntervalS !== undefined
						? { syncIntervalS: patch.syncIntervalS }
						: {}),
					...(patch.colorOverride !== undefined
						? { colorOverride: patch.colorOverride }
						: {}),
					...(patch.displaynameOverride !== undefined
						? { displaynameOverride: patch.displaynameOverride }
						: {}),
				})
				.where(eq(externalCalendarClaim.id, id))
				.returning(),
		).pipe(
			Effect.flatMap((r) => {
				const row = r[0];
				if (!row) {
					return Effect.fail(
						new DatabaseError({
							cause: new Error("updateClaim returned no rows"),
						}),
					);
				}
				return Effect.succeed(row);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.externalCalendar.updateClaim failed", e.cause),
	),
);

const clearHttpCache = Effect.fn("ExternalCalendarRepository.clearHttpCache")(
	function* (id: UuidString) {
		yield* Effect.annotateCurrentSpan({ "external_calendar.id": id });
		yield* runDbQuery((db) =>
			db
				.update(externalCalendar)
				.set({ httpEtag: null, httpLastModified: null })
				.where(eq(externalCalendar.id, id)),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.externalCalendar.clearHttpCache failed", e.cause),
	),
);

const deleteClaim = Effect.fn("ExternalCalendarRepository.deleteClaim")(
	function* (id: UuidString) {
		yield* Effect.annotateCurrentSpan({ "claim.id": id });
		yield* runDbQuery((db) =>
			db.delete(externalCalendarClaim).where(eq(externalCalendarClaim.id, id)),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.externalCalendar.deleteClaim failed", e.cause),
	),
);

export const ExternalCalendarRepositoryLive = Layer.effect(
	ExternalCalendarRepository,
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(
			e: Effect.Effect<A, E, DatabaseClient>,
		): Effect.Effect<A, E> => Effect.provideService(e, DatabaseClient, dc);
		return {
			findById: (...args: Parameters<typeof findById>) =>
				run(findById(...args)),
			findByUrl: (...args: Parameters<typeof findByUrl>) =>
				run(findByUrl(...args)),
			upsertByUrl: (...args: Parameters<typeof upsertByUrl>) =>
				run(upsertByUrl(...args)),
			softDelete: (...args: Parameters<typeof softDelete>) =>
				run(softDelete(...args)),
			recordSyncResult: (...args: Parameters<typeof recordSyncResult>) =>
				run(recordSyncResult(...args)),
			recomputeSyncInterval: (
				...args: Parameters<typeof recomputeSyncInterval>
			) => run(recomputeSyncInterval(...args)),
			findDue: (...args: Parameters<typeof findDue>) => run(findDue(...args)),
			findClaimById: (...args: Parameters<typeof findClaimById>) =>
				run(findClaimById(...args)),
			findClaimByCollection: (
				...args: Parameters<typeof findClaimByCollection>
			) => run(findClaimByCollection(...args)),
			listClaimsForExternal: (
				...args: Parameters<typeof listClaimsForExternal>
			) => run(listClaimsForExternal(...args)),
			listClaimsWithExternalForPrincipal: (
				...args: Parameters<typeof listClaimsWithExternalForPrincipal>
			) => run(listClaimsWithExternalForPrincipal(...args)),
			countClaimsForExternal: (
				...args: Parameters<typeof countClaimsForExternal>
			) => run(countClaimsForExternal(...args)),
			insertClaim: (...args: Parameters<typeof insertClaim>) =>
				run(insertClaim(...args)),
			clearHttpCache: (...args: Parameters<typeof clearHttpCache>) =>
				run(clearHttpCache(...args)),
			updateClaim: (...args: Parameters<typeof updateClaim>) =>
				run(updateClaim(...args)),
			deleteClaim: (...args: Parameters<typeof deleteClaim>) =>
				run(deleteClaim(...args)),
		};
	}),
);
