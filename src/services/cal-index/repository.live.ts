import { Temporal as JSTemporal } from "@js-temporal/polyfill";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { RRuleTemporal } from "rrule-temporal";
import type { Temporal } from "temporal-polyfill";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { calIndex, davInstance } from "#src/db/drizzle/schema/index.ts";
import { getActiveDb } from "#src/db/transaction.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, EntityId } from "#src/domain/ids.ts";
import { type CalComponentType, CalIndexRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// CalIndexRepository — Drizzle implementation
// ---------------------------------------------------------------------------

/**
 * Build the RRULE WHERE clause for findByTimeRange.
 *
 * When weekStart/weekEnd are provided, applies a week-bucket heuristic that
 * filters out recurring events whose pattern cannot produce an occurrence in
 * the calendar week [weekStart, weekEnd). False positives are acceptable
 * (the in-memory filter does the exact check); false negatives are not.
 *
 * When either is null, falls back to the conservative "all RRULE rows pass".
 */
const rruleWeekBucketClause = (
	weekStart: Temporal.Instant | null,
	weekEnd: Temporal.Instant | null,
) => {
	if (weekStart === null || weekEnd === null) {
		return isNotNull(calIndex.rruleText);
	}
	const ws = weekStart.toString();
	const we = weekEnd.toString();

	return and(
		isNotNull(calIndex.rruleText),
		// Series must have started by weekEnd
		sql`${calIndex.dtstartUtc} <= ${we}::timestamptz`,
		// Active rule: no UNTIL, or UNTIL is at or after weekStart
		or(
			isNull(calIndex.rruleUntilUtc),
			sql`${calIndex.rruleUntilUtc} >= ${ws}::timestamptz`,
		),
		// Week-bucket match — one of the following must be true:
		or(
			// Sub-daily frequencies always fire within any week
			sql`${calIndex.rruleFreq} IN ('DAILY', 'HOURLY', 'MINUTELY', 'SECONDLY')`,

			// WEEKLY: the week containing dtstart + n*interval weeks lands on weekStart
			sql`(
				${calIndex.rruleFreq} = 'WEEKLY'
				AND FLOOR(EXTRACT(EPOCH FROM (${ws}::timestamptz - ${calIndex.dtstartUtc})) / 604800.0)::bigint
					% COALESCE(${calIndex.rruleInterval}, 1) = 0
			)`,

			// MONTHLY: precomputed day range intersects the week + interval check.
			// Pass conservatively when not yet indexed (day_min IS NULL).
			and(
				sql`${calIndex.rruleFreq} = 'MONTHLY'`,
				or(
					isNull(calIndex.rruleOccurrenceDayMin),
					and(
						sql`${calIndex.rruleOccurrenceDayMin} <= EXTRACT(DAY FROM ${we}::timestamptz)::int`,
						sql`${calIndex.rruleOccurrenceDayMax} >= EXTRACT(DAY FROM ${ws}::timestamptz)::int`,
						sql`(
							(EXTRACT(YEAR  FROM ${ws}::timestamptz)::int - EXTRACT(YEAR  FROM ${calIndex.dtstartUtc})::int) * 12
							+ EXTRACT(MONTH FROM ${ws}::timestamptz)::int - EXTRACT(MONTH FROM ${calIndex.dtstartUtc})::int
						) % COALESCE(${calIndex.rruleInterval}, 1) = 0`,
					),
				),
			),

			// YEARLY: precomputed months contains the queried week's month + interval check.
			// Pass conservatively when not yet indexed (occurrence_months IS NULL).
			and(
				sql`${calIndex.rruleFreq} = 'YEARLY'`,
				or(
					isNull(calIndex.rruleOccurrenceMonths),
					and(
						sql`(
							EXTRACT(MONTH FROM ${ws}::timestamptz)::int = ANY(${calIndex.rruleOccurrenceMonths})
							OR EXTRACT(MONTH FROM ${we}::timestamptz)::int = ANY(${calIndex.rruleOccurrenceMonths})
						)`,
						sql`(EXTRACT(YEAR FROM ${ws}::timestamptz)::int - EXTRACT(YEAR FROM ${calIndex.dtstartUtc})::int)
							% COALESCE(${calIndex.rruleInterval}, 1) = 0`,
					),
				),
			),

			// Unknown / unrecognised freq: pass conservatively
			sql`(
				${calIndex.rruleFreq} IS NULL
				OR ${calIndex.rruleFreq} NOT IN ('DAILY', 'HOURLY', 'MINUTELY', 'SECONDLY', 'WEEKLY', 'MONTHLY', 'YEARLY')
			)`,
		),
	);
};

const findByTimeRange = Effect.fn("CalIndexRepository.findByTimeRange")(
	function* (
		db: DbClient,
		collectionId: CollectionId,
		componentType: CalComponentType,
		start: Temporal.Instant | null,
		end: Temporal.Instant | null,
		weekStart: Temporal.Instant | null,
		weekEnd: Temporal.Instant | null,
	) {
		yield* Effect.annotateCurrentSpan({
			"collection.id": collectionId,
			"cal.component_type": componentType,
		});
		yield* Effect.logTrace("repo.cal-index.findByTimeRange", {
			collectionId,
			componentType,
		});
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.selectDistinct({ instanceId: davInstance.id })
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
							or(
								// Non-RRULE: standard dtstart/dtend overlap
								and(
									isNull(calIndex.rruleText),
									start !== null
										? or(
												isNull(calIndex.dtendUtc),
												sql`${calIndex.dtendUtc} > ${start.toString()}::timestamptz`,
											)
										: undefined,
									end !== null
										? sql`${calIndex.dtstartUtc} < ${end.toString()}::timestamptz`
										: undefined,
								),
								// RRULE: week-bucket pre-filter
								rruleWeekBucketClause(weekStart, weekEnd),
							),
						),
					)
					.then((rows) => rows.map((r) => r.instanceId)),
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
		yield* Effect.annotateCurrentSpan({
			"collection.id": collectionId,
			"cal.component_type": componentType,
		});
		yield* Effect.logTrace("repo.cal-index.findByComponentType", {
			collectionId,
			componentType,
		});
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.selectDistinct({ instanceId: davInstance.id })
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
					.then((rows) => rows.map((r) => r.instanceId)),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.cal-index.findByComponentType failed", e.cause),
	),
);

const indexRruleOccurrences = Effect.fn(
	"CalIndexRepository.indexRruleOccurrences",
)(
	function* (db: DbClient, entityId: EntityId) {
		yield* Effect.annotateCurrentSpan({ "entity.id": entityId });
		yield* Effect.logTrace("repo.cal-index.indexRruleOccurrences", {
			entityId,
		});

		const activeDb = yield* getActiveDb(db);

		const rows = yield* Effect.tryPromise({
			try: () =>
				activeDb
					.select({
						componentId: calIndex.componentId,
						rruleText: calIndex.rruleText,
						dtstartUtc: calIndex.dtstartUtc,
					})
					.from(calIndex)
					.where(
						and(
							eq(calIndex.entityId, entityId),
							isNotNull(calIndex.rruleText),
							isNull(calIndex.deletedAt),
						),
					),
			catch: (e) => new DatabaseError({ cause: e }),
		});

		for (const row of rows) {
			if (row.rruleText === null || row.dtstartUtc === null) {
				continue;
			}

			// Convert temporal-polyfill Instant → @js-temporal/polyfill ZonedDateTime
			const dtstart = JSTemporal.Instant.fromEpochMilliseconds(
				row.dtstartUtc.epochMilliseconds,
			).toZonedDateTimeISO("UTC");

			const rule = new RRuleTemporal({ rruleString: row.rruleText, dtstart });

			// Sample 24 occurrences — sufficient to determine the pattern:
			//   MONTHLY → covers 24 months (2 years)
			//   YEARLY  → covers 24 years
			const sample = rule.all((_, i) => i < 24);
			if (sample.length === 0) {
				continue;
			}

			const months = [...new Set(sample.map((d) => d.month))].sort(
				(a, b) => a - b,
			);
			const dayMin = Math.min(...sample.map((d) => d.day));
			const dayMax = Math.max(...sample.map((d) => d.day));

			yield* Effect.tryPromise({
				try: () =>
					activeDb
						.update(calIndex)
						.set({
							rruleOccurrenceMonths: months,
							rruleOccurrenceDayMin: dayMin,
							rruleOccurrenceDayMax: dayMax,
						})
						.where(eq(calIndex.componentId, row.componentId)),
				catch: (e) => new DatabaseError({ cause: e }),
			});
		}
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.cal-index.indexRruleOccurrences failed", e.cause),
	),
);

export const CalIndexRepositoryLive = Layer.effect(
	CalIndexRepository,
	Effect.map(DatabaseClient, (db) =>
		CalIndexRepository.of({
			findByTimeRange: (
				collectionId,
				componentType,
				start,
				end,
				weekStart,
				weekEnd,
			) =>
				findByTimeRange(
					db,
					collectionId,
					componentType,
					start,
					end,
					weekStart,
					weekEnd,
				),
			findByComponentType: (collectionId, componentType) =>
				findByComponentType(db, collectionId, componentType),
			indexRruleOccurrences: (entityId) => indexRruleOccurrences(db, entityId),
		}),
	),
);
