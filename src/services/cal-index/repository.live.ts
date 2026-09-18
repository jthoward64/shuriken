import { Temporal as JSTemporal } from "@js-temporal/polyfill";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { type Cause, Effect, Layer, Option } from "effect";
import { RRuleTemporal } from "rrule-temporal";
import type { Temporal } from "temporal-polyfill";
import { normalizeRruleUntil } from "#src/data/icalendar/recurrence/recurrence-check.ts";
import {
	type ResolutionZone,
	UTC,
} from "#src/data/icalendar/resolve-floating.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { calIndex, davInstance } from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
import type { CollectionId, EntityId } from "#src/domain/ids.ts";
import {
	type CalComponentType,
	CalIndexRepository,
	type CalIndexWindow,
} from "./repository.ts";

// ---------------------------------------------------------------------------
// CalIndexRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;
// Enough occurrences to determine a MONTHLY (2 years) or YEARLY (24 years) pattern
const RRULE_SAMPLE_SIZE = 24;
// UTC offsets run from -12:00 to +14:00, so a wall time indexed at UTC sits at
// most 14 hours from the instant it names in some other zone.
const MAX_ZONE_OFFSET_HOURS = 14;

/**
 * Widen a query window to stay a correct superset for a non-UTC zone.
 *
 * The `maintain_cal_index_on_instance_change` trigger pins both kinds of local
 * value to UTC: an all-day DTSTART at UTC midnight, a floating DTSTART at its
 * wall time. Either can sit up to a whole offset away from the instant it names
 * in the resolution zone, and a narrow window would then drop it. Widening by
 * the largest possible offset keeps the pre-filter a superset without
 * reindexing anything; the in-memory pass still does the exact check.
 */
const zonePaddedRange = (
	start: Temporal.Instant | null,
	end: Temporal.Instant | null,
	zone: ResolutionZone,
): { start: Temporal.Instant | null; end: Temporal.Instant | null } => {
	if (zone === UTC) {
		return { start, end };
	}
	return {
		start: start?.subtract({ hours: MAX_ZONE_OFFSET_HOURS }) ?? null,
		end: end?.add({ hours: MAX_ZONE_OFFSET_HOURS }) ?? null,
	};
};
// A span this long covers every day-of-month / every month, so the
// corresponding narrowing can add nothing.
const SPAN_DAYS_COVERING_ALL_DAYS = 28;
const SPAN_DAYS_COVERING_ALL_MONTHS = 365;

interface DayRange {
	readonly min: number;
	readonly max: number;
}

/** Day-of-month range covered by the window, absent when every day is covered */
const coveredDays = (
	zs: Temporal.ZonedDateTime,
	ze: Temporal.ZonedDateTime,
	spanDays: number,
): Option.Option<DayRange> => {
	if (spanDays >= SPAN_DAYS_COVERING_ALL_DAYS) {
		return Option.none(); // covers every day-of-month
	}
	if (zs.year !== ze.year || zs.month !== ze.month) {
		return Option.none(); // crosses a month boundary; min/max would be 1..31
	}
	return Option.some({ min: zs.day, max: ze.day });
};

/** Months touched by the window, absent when every month is covered */
const coveredMonths = (
	zs: Temporal.ZonedDateTime,
	ze: Temporal.ZonedDateTime,
	spanDays: number,
): Option.Option<ReadonlyArray<number>> => {
	if (spanDays >= SPAN_DAYS_COVERING_ALL_MONTHS) {
		return Option.none(); // covers every month
	}
	const out: Array<number> = [];
	let cursor = zs.with({ day: 1 });
	const limit = ze.with({ day: 1 });
	while (cursor.epochMilliseconds <= limit.epochMilliseconds) {
		out.push(cursor.month);
		cursor = cursor.add({ months: 1 });
	}
	return out.length > 0 ? Option.some(out) : Option.none();
};

/**
 * Day-of-month and month spans covered by [start, end), used to narrow MONTHLY
 * and YEARLY series. Each is absent for a span long enough to cover every
 * value, in which case the corresponding check is skipped.
 */
const coveredSpans = (
	start: Temporal.Instant,
	end: Temporal.Instant,
): {
	readonly days: Option.Option<DayRange>;
	readonly months: Option.Option<ReadonlyArray<number>>;
} => {
	const spanDays =
		end.epochMilliseconds - start.epochMilliseconds < 0
			? 0
			: (end.epochMilliseconds - start.epochMilliseconds) / MS_PER_DAY;
	const zs = start.toZonedDateTimeISO("UTC");
	const ze = end.toZonedDateTimeISO("UTC");
	return {
		days: coveredDays(zs, ze, spanDays),
		months: coveredMonths(zs, ze, spanDays),
	};
};

/**
 * Build the RRULE WHERE clause for findByTimeRange.
 *
 * Always applies the window-agnostic bounds (the series starts before `end` and
 * is not provably finished before `start`). When the window is bounded, it
 * additionally applies a frequency-bucket heuristic that drops series whose
 * pattern cannot fire anywhere in [start, end). False positives are acceptable
 * (the in-memory filter does the exact check); false negatives are not.
 *
 * An open-ended window admits every live series: RFC 4791 section 9.9 reads a
 * missing `end` as +infinity, and any live recurrence eventually fires.
 */
const rruleBucketClause = (
	start: Temporal.Instant | null,
	end: Temporal.Instant | null,
) => {
	const base = rruleRangeClause(start, end);
	if (start === null || end === null) {
		return base;
	}
	const s = start.toString();
	const e = end.toString();
	const interval = sql`COALESCE(${calIndex.rruleInterval}, 1)`;

	const weekIdx = (t: string) =>
		sql`FLOOR(EXTRACT(EPOCH FROM (${t}::timestamptz - ${calIndex.dtstartUtc})) / 604800.0)::bigint`;
	const monthIdx = (t: string) =>
		sql`((EXTRACT(YEAR FROM ${t}::timestamptz)::int - EXTRACT(YEAR FROM ${calIndex.dtstartUtc})::int) * 12
			+ EXTRACT(MONTH FROM ${t}::timestamptz)::int - EXTRACT(MONTH FROM ${calIndex.dtstartUtc})::int)`;
	const yearIdx = (t: string) =>
		sql`(EXTRACT(YEAR FROM ${t}::timestamptz)::int - EXTRACT(YEAR FROM ${calIndex.dtstartUtc})::int)`;

	// Occurrences land on period indices k*interval. BYDAY/BYMONTHDAY can shift
	// one off its period anchor, so widen the covered index range by one on each
	// side, then test whether it contains a multiple of the interval.
	const firesInSpan = (
		i0: ReturnType<typeof sql>,
		i1: ReturnType<typeof sql>,
	) =>
		sql`((${i0}) - 1 <= 0 OR FLOOR(((${i1}) + 1) / ${interval}) * ${interval} >= (${i0}) - 1)`;

	const { days, months } = coveredSpans(start, end);

	return and(
		base,
		or(
			// Sub-daily frequencies fire within any window
			sql`${calIndex.rruleFreq} IN ('DAILY', 'HOURLY', 'MINUTELY', 'SECONDLY')`,

			and(
				sql`${calIndex.rruleFreq} = 'WEEKLY'`,
				firesInSpan(weekIdx(s), weekIdx(e)),
			),

			// Pass conservatively when the day range is not yet indexed
			and(
				sql`${calIndex.rruleFreq} = 'MONTHLY'`,
				firesInSpan(monthIdx(s), monthIdx(e)),
				Option.match(days, {
					onNone: () => undefined,
					onSome: (range) =>
						or(
							isNull(calIndex.rruleOccurrenceDayMin),
							and(
								sql`${calIndex.rruleOccurrenceDayMin} <= ${range.max}`,
								sql`${calIndex.rruleOccurrenceDayMax} >= ${range.min}`,
							),
						),
				}),
			),

			// Pass conservatively when the month set is not yet indexed
			and(
				sql`${calIndex.rruleFreq} = 'YEARLY'`,
				firesInSpan(yearIdx(s), yearIdx(e)),
				Option.match(months, {
					onNone: () => undefined,
					onSome: (list) =>
						or(
							isNull(calIndex.rruleOccurrenceMonths),
							sql`${calIndex.rruleOccurrenceMonths} && ARRAY[${sql.join(
								list.map((m) => sql`${m}`),
								sql`, `,
							)}]::smallint[]`,
						),
				}),
			),

			// Unknown / unrecognised freq: pass conservatively
			sql`(
				${calIndex.rruleFreq} IS NULL
				OR ${calIndex.rruleFreq} NOT IN ('DAILY', 'HOURLY', 'MINUTELY', 'SECONDLY', 'WEEKLY', 'MONTHLY', 'YEARLY')
			)`,
		),
	);
};

type RruleSample = ReturnType<RRuleTemporal["all"]>;

/**
 * First occurrences of a series, used to derive the month/day occurrence hints.
 *
 * A malformed RRULE (beyond the naive-UNTIL case normalizeRruleUntil handles)
 * must not fail the whole write/index pass. On a residual expansion error the
 * sample is absent, the hints stay NULL, and the week-bucket pre-filter passes
 * the row conservatively (correct, just less selective).
 */
const sampleOccurrences = Effect.fn("repo.cal-index.sampleOccurrences")(
	function* (rruleText: string, dtstart: JSTemporal.ZonedDateTime) {
		return yield* Effect.try(() =>
			new RRuleTemporal({
				rruleString: normalizeRruleUntil(rruleText, UTC, dtstart),
				dtstart,
				// Sample 24 occurrences — sufficient to determine the pattern:
				//   MONTHLY → covers 24 months (2 years)
				//   YEARLY  → covers 24 years
			}).all((_, i) => i < RRULE_SAMPLE_SIZE),
		).pipe(
			Effect.map(Option.some<RruleSample>),
			Effect.catchCause((cause) => logMalformedRrule(rruleText, cause)),
		);
	},
);

/** Records a skipped occurrence-hint pass so the drop is never silent. */
const logMalformedRrule = Effect.fn("repo.cal-index.logMalformedRrule")(
	function* (rruleText: string, cause: Cause.Cause<unknown>) {
		yield* Effect.logWarning(
			"repo.cal-index: skipping occurrence-hint indexing for a malformed RRULE",
			{ rruleText, cause },
		);
		return Option.none<RruleSample>();
	},
);

/**
 * Exact dtstart/dtend overlap clause for non-recurring (no RRULE) rows.
 * Shared by findByTimeRange and findOverlappingRange.
 */
const nonRecurringOverlapClause = (
	start: Temporal.Instant | null,
	end: Temporal.Instant | null,
) =>
	and(
		isNull(calIndex.rruleText),
		start !== null
			? or(
					isNull(calIndex.dtendUtc),
					sql`${calIndex.dtendUtc} > ${start.toString()}::timestamptz`,
				)
			: undefined,
		// A NULL dtstart_utc means the component has no DTSTART at all (a VTODO
		// with only DUE, a VFREEBUSY without one), so it must stay a candidate and
		// the in-memory pass does the exact check. Floating DTSTARTs are indexed
		// at their wall time pinned to UTC and narrowed by zonePaddedRange above,
		// so they are NOT in this branch - they filter like any other row.
		end !== null
			? sql`(${calIndex.dtstartUtc} IS NULL OR ${calIndex.dtstartUtc} < ${end.toString()}::timestamptz)`
			: undefined,
	);

/**
 * Window-agnostic RRULE superset clause: the series starts before `end` and is
 * not provably finished before `start`. Correct for an arbitrary window (no
 * week-bucket assumption); over-approximates (COUNT-bounded series, gaps) but
 * never drops a series that could have an occurrence in range.
 */
const rruleRangeClause = (
	start: Temporal.Instant | null,
	end: Temporal.Instant | null,
) =>
	and(
		isNotNull(calIndex.rruleText),
		end !== null
			? sql`(${calIndex.dtstartUtc} IS NULL OR ${calIndex.dtstartUtc} < ${end.toString()}::timestamptz)`
			: undefined,
		start !== null
			? or(
					isNull(calIndex.rruleUntilUtc),
					sql`${calIndex.rruleUntilUtc} > ${start.toString()}::timestamptz`,
				)
			: undefined,
	);

const findByTimeRange = Effect.fn("CalIndexRepository.findByTimeRange")(
	function* (
		collectionId: CollectionId,
		componentType: CalComponentType,
		window: CalIndexWindow,
	) {
		const { start: rangeStart, end: rangeEnd, zone } = window;
		yield* Effect.annotateCurrentSpan({
			"collection.id": collectionId,
			"cal.component_type": componentType,
		});
		yield* Effect.logTrace("repo.cal-index.findByTimeRange", {
			collectionId,
			componentType,
		});
		const { start, end } = zonePaddedRange(rangeStart, rangeEnd, zone);
		return yield* runDbQuery((db) =>
			db
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
							nonRecurringOverlapClause(start, end),
							// RRULE: range-aware bucket pre-filter
							rruleBucketClause(start, end),
						),
					),
				),
		).pipe(Effect.map((rows) => rows.map((r) => r.instanceId)));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.cal-index.findByTimeRange failed", e.cause),
	),
);

const findByComponentType = Effect.fn("CalIndexRepository.findByComponentType")(
	function* (collectionId: CollectionId, componentType: CalComponentType) {
		yield* Effect.annotateCurrentSpan({
			"collection.id": collectionId,
			"cal.component_type": componentType,
		});
		yield* Effect.logTrace("repo.cal-index.findByComponentType", {
			collectionId,
			componentType,
		});
		return yield* runDbQuery((db) =>
			db
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
				),
		).pipe(Effect.map((rows) => rows.map((r) => r.instanceId)));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.cal-index.findByComponentType failed", e.cause),
	),
);

const findOverlappingRange = Effect.fn(
	"CalIndexRepository.findOverlappingRange",
)(
	function* (
		collectionId: CollectionId,
		componentType: CalComponentType,
		window: CalIndexWindow,
	) {
		const { start: rangeStart, end: rangeEnd, zone } = window;
		yield* Effect.annotateCurrentSpan({
			"collection.id": collectionId,
			"cal.component_type": componentType,
		});
		yield* Effect.logTrace("repo.cal-index.findOverlappingRange", {
			collectionId,
			componentType,
		});
		const { start, end } = zonePaddedRange(rangeStart, rangeEnd, zone);
		return yield* runDbQuery((db) =>
			db
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
							nonRecurringOverlapClause(start, end),
							rruleRangeClause(start, end),
						),
					),
				),
		).pipe(Effect.map((rows) => rows.map((r) => r.instanceId)));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.cal-index.findOverlappingRange failed", e.cause),
	),
);

const indexRruleOccurrences = Effect.fn(
	"CalIndexRepository.indexRruleOccurrences",
)(
	function* (entityId: EntityId) {
		yield* Effect.annotateCurrentSpan({ "entity.id": entityId });
		yield* Effect.logTrace("repo.cal-index.indexRruleOccurrences", {
			entityId,
		});

		const rows = yield* runDbQuery((db) =>
			db
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
		);

		for (const row of rows) {
			if (row.rruleText === null || row.dtstartUtc === null) {
				continue;
			}

			// Convert temporal-polyfill Instant → @js-temporal/polyfill ZonedDateTime
			const dtstart = JSTemporal.Instant.fromEpochMilliseconds(
				row.dtstartUtc.epochMilliseconds,
			).toZonedDateTimeISO("UTC");

			const sampled = yield* sampleOccurrences(row.rruleText, dtstart);
			if (Option.isNone(sampled) || sampled.value.length === 0) {
				continue;
			}
			const sample = sampled.value;

			const months = [...new Set(sample.map((d) => d.month))].sort(
				(a, b) => a - b,
			);
			const dayMin = Math.min(...sample.map((d) => d.day));
			const dayMax = Math.max(...sample.map((d) => d.day));

			yield* runDbQuery((db) =>
				db
					.update(calIndex)
					.set({
						rruleOccurrenceMonths: months,
						rruleOccurrenceDayMin: dayMin,
						rruleOccurrenceDayMax: dayMax,
					})
					.where(eq(calIndex.componentId, row.componentId)),
			).pipe(Effect.asVoid);
		}
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.cal-index.indexRruleOccurrences failed", e.cause),
	),
);

export const CalIndexRepositoryLive = Layer.effect(
	CalIndexRepository,
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(
			e: Effect.Effect<A, E, DatabaseClient>,
		): Effect.Effect<A, E> => Effect.provideService(e, DatabaseClient, dc);
		return {
			findByTimeRange: (...args: Parameters<typeof findByTimeRange>) =>
				run(findByTimeRange(...args)),
			findByComponentType: (...args: Parameters<typeof findByComponentType>) =>
				run(findByComponentType(...args)),
			findOverlappingRange: (
				...args: Parameters<typeof findOverlappingRange>
			) => run(findOverlappingRange(...args)),
			indexRruleOccurrences: (
				...args: Parameters<typeof indexRruleOccurrences>
			) => run(indexRruleOccurrences(...args)),
		};
	}),
);
