import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Effect, Layer } from "effect";
import type { Temporal } from "temporal-polyfill";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { calIndex, davInstance } from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId } from "#src/domain/ids.ts";
import { type CalComponentType, CalIndexRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// CalIndexRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const findByTimeRange = Effect.fn("CalIndexRepository.findByTimeRange")(
	function* (
		db: DbClient,
		collectionId: CollectionId,
		componentType: CalComponentType,
		start: Temporal.Instant | null,
		end: Temporal.Instant | null,
	) {
		yield* Effect.logTrace("repo.cal-index.findByTimeRange", {
			collectionId,
			componentType,
		});
		return yield* Effect.tryPromise({
			try: () =>
				db
					.selectDistinct({ entityId: calIndex.entityId })
					.from(calIndex)
					.innerJoin(
						davInstance,
						and(
							eq(calIndex.entityId, davInstance.entityId),
							eq(davInstance.collectionId, collectionId),
							isNull(davInstance.deletedAt),
						),
					)
					.where(
						and(
							eq(calIndex.componentType, componentType),
							isNull(calIndex.deletedAt),
							// Events with RRULE always pass time-range (conservative recurrence handling)
							// TODO(recurrence): expand rrule_text for accurate overlap when recurrence
							// expansion is implemented.
							or(
								isNotNull(calIndex.rruleText),
								and(
									// dtend_utc > start (open-ended if dtend is null)
									start !== null
										? or(
												isNull(calIndex.dtendUtc),
												sql`${calIndex.dtendUtc} > ${start.toString()}::timestamptz`,
											)
										: undefined,
									// dtstart_utc < end
									end !== null
										? sql`${calIndex.dtstartUtc} < ${end.toString()}::timestamptz`
										: undefined,
								),
							),
						),
					)
					.then((rows) => rows.map((r) => r.entityId)),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.cal-index.findByTimeRange failed", e.cause),
	),
);

const findByComponentType = Effect.fn("CalIndexRepository.findByComponentType")(
	function* (
		db: DbClient,
		collectionId: CollectionId,
		componentType: CalComponentType,
	) {
		yield* Effect.logTrace("repo.cal-index.findByComponentType", {
			collectionId,
			componentType,
		});
		return yield* Effect.tryPromise({
			try: () =>
				db
					.selectDistinct({ entityId: calIndex.entityId })
					.from(calIndex)
					.innerJoin(
						davInstance,
						and(
							eq(calIndex.entityId, davInstance.entityId),
							eq(davInstance.collectionId, collectionId),
							isNull(davInstance.deletedAt),
						),
					)
					.where(
						and(
							eq(calIndex.componentType, componentType),
							isNull(calIndex.deletedAt),
						),
					)
					.then((rows) => rows.map((r) => r.entityId)),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.cal-index.findByComponentType failed", e.cause),
	),
);

export const CalIndexRepositoryLive = Layer.effect(
	CalIndexRepository,
	Effect.map(DatabaseClient, (db) =>
		CalIndexRepository.of({
			findByTimeRange: (collectionId, componentType, start, end) =>
				findByTimeRange(db, collectionId, componentType, start, end),
			findByComponentType: (collectionId, componentType) =>
				findByComponentType(db, collectionId, componentType),
		}),
	),
);
