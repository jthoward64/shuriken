// ---------------------------------------------------------------------------
// hasOccurrenceInRange — RFC 5545 RRULE expansion for CalDAV time-range filters
//
// Uses rrule-temporal (which internally uses @js-temporal/polyfill) to expand
// a master VEVENT's RRULE and check whether any occurrence falls within the
// requested time range.
//
// RECURRENCE-ID overrides: the override VEVENT's RECURRENCE-ID is added to
// exDate so the master rule skips that slot. The override itself is evaluated
// by the existing non-RRULE path in evalComponentTimeRange.
// ---------------------------------------------------------------------------

import { Temporal as JSTemporal } from "@js-temporal/polyfill";
import { RRuleTemporal } from "rrule-temporal";
import { Temporal } from "temporal-polyfill";
import type { IrComponent, IrValue } from "#src/data/ir.ts";

// ---------------------------------------------------------------------------
// Helpers: convert temporal-polyfill values → @js-temporal/polyfill via strings
// ---------------------------------------------------------------------------

/** Single date/time IrValue → @js-temporal/polyfill ZonedDateTime, or undefined. */
const irSingleValueToJsZdt = (
	v: IrValue,
): JSTemporal.ZonedDateTime | undefined => {
	if (v.type === "DATE_TIME") {
		return JSTemporal.ZonedDateTime.from(v.value.toString());
	}
	if (v.type === "DATE") {
		return JSTemporal.ZonedDateTime.from(`${v.value.toString()}T00:00:00[UTC]`);
	}
	if (v.type === "PLAIN_DATE_TIME") {
		// Floating — no timezone; treat as UTC for range comparison
		return JSTemporal.ZonedDateTime.from(`${v.value.toString()}[UTC]`);
	}
	return undefined;
};

/** Any EXDATE/RDATE IrValue variant → list of @js-temporal/polyfill ZonedDateTimes. */
const irDateListToJsZdts = (v: IrValue): Array<JSTemporal.ZonedDateTime> => {
	if (v.type === "DATE_TIME_LIST") {
		return v.value.map((dt) =>
			// Floating items (PlainDateTime) carry no zone — treat as UTC for range
			// comparison, matching the single-value rule above.
			"timeZoneId" in dt
				? JSTemporal.ZonedDateTime.from(dt.toString())
				: JSTemporal.ZonedDateTime.from(`${dt.toString()}[UTC]`),
		);
	}
	if (v.type === "DATE_LIST") {
		return v.value.map((pd) =>
			JSTemporal.ZonedDateTime.from(`${pd.toString()}T00:00:00[UTC]`),
		);
	}
	// Single-value fallback (some clients emit EXDATE with a single DATE_TIME)
	const single = irSingleValueToJsZdt(v);
	return single ? [single] : [];
};

const TWO_DIGITS = 2;
const YEAR_DIGITS = 4;
const pad = (n: number, width = TWO_DIGITS): string =>
	String(n).padStart(width, "0");

/**
 * rrule-temporal requires an RRULE `UNTIL` to be a UTC datetime (trailing `Z`)
 * or a DATE, and THROWS otherwise. Real-world clients (Google, Apple, older
 * Exchange) routinely emit a naive local datetime `UNTIL=YYYYMMDDTHHMMSS` with
 * no `Z`; left unhandled, one such event crashes the entire calendar-query
 * REPORT (HTTP 500), which stops a client like iOS from syncing the collection
 * at all.
 *
 * Rewrite a naive datetime UNTIL to its UTC equivalent. RFC 5545 §3.3.10 says a
 * datetime UNTIL shares DTSTART's time reference, so the naive value is
 * interpreted in DTSTART's timezone (e.g. `UNTIL=20260502T010000` with
 * `DTSTART;TZID=America/New_York` is 01:00 New York → 05:00 UTC), not blindly as
 * UTC — otherwise the series-end bound is off by the zone offset and can drop the
 * final occurrence. When DTSTART is floating/unknown we fall back to UTC (which
 * matches how floating DTSTARTs are handled elsewhere in this module).
 * Already-UTC (`…Z`) and DATE-only UNTILs are left untouched (rrule-temporal
 * accepts both).
 */
export const normalizeRruleUntil = (
	rruleString: string,
	dtstart?: JSTemporal.ZonedDateTime,
): string => {
	const timeZone = dtstart?.timeZoneId ?? "UTC";
	return rruleString.replace(
		/UNTIL=(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?![\dZ])/g,
		(_match, y, mo, d, h, mi, s) => {
			const utc = JSTemporal.PlainDateTime.from({
				year: Number(y),
				month: Number(mo),
				day: Number(d),
				hour: Number(h),
				minute: Number(mi),
				second: Number(s),
			})
				.toZonedDateTime(timeZone)
				.toInstant()
				.toZonedDateTimeISO("UTC");
			return `UNTIL=${pad(utc.year, YEAR_DIGITS)}${pad(utc.month)}${pad(utc.day)}T${pad(utc.hour)}${pad(utc.minute)}${pad(utc.second)}Z`;
		},
	);
};

// ---------------------------------------------------------------------------
// Bounded expansion — RRULE occurrence generation is otherwise unbounded: a
// rule like `FREQ=SECONDLY` with no COUNT/UNTIL, queried over a wide/open
// time-range, would enumerate tens of millions of occurrences synchronously.
// `rule.all(iterator)` supports early exit via its iterator callback (unlike
// `.between()`, which calls `.all()` internally with no way to interrupt it),
// so occurrence generation is capped here by both a hard iteration count and
// a wall-clock budget, independent of how wide the caller's range is. Either
// cap tripping just truncates the occurrence list rather than failing the
// request — callers see "no more occurrences found," not an error.
// ---------------------------------------------------------------------------

/**
 * True for RRULEs dense enough to be pathological even under the expansion
 * caps above — `FREQ=SECONDLY`/`MINUTELY` with no `COUNT`/`UNTIL` bound
 * generates an occurrence for every second/minute from DTSTART onward.
 * Used at PUT time (`http/dav/methods/put.ts`) to reject such rules
 * up front rather than silently truncating query results against them later.
 */
export const isUnboundedHighFrequencyRrule = (rruleValue: string): boolean => {
	const freqMatch = /(?:^|;)FREQ=([A-Z]+)/.exec(rruleValue);
	const freq = freqMatch?.[1];
	if (freq !== "SECONDLY" && freq !== "MINUTELY") {
		return false;
	}
	return !/(?:^|;)(?:COUNT|UNTIL)=/.test(rruleValue);
};

export interface RruleExpansionLimits {
	readonly maxOccurrencesChecked: number;
	readonly timeBudgetMs: number;
}

const DEFAULT_RRULE_MAX_OCCURRENCES_CHECKED = 200_000;
const DEFAULT_RRULE_TIME_BUDGET_MS = 250;

export const DEFAULT_RRULE_LIMITS: RruleExpansionLimits = {
	maxOccurrencesChecked: DEFAULT_RRULE_MAX_OCCURRENCES_CHECKED,
	timeBudgetMs: DEFAULT_RRULE_TIME_BUDGET_MS,
};

const TIME_CHECK_EVERY = 500;

const boundedOccurrencesInRange = (
	rule: RRuleTemporal,
	queryStart: Temporal.Instant,
	queryEnd: Temporal.Instant,
	limits: RruleExpansionLimits,
): ReadonlyArray<Temporal.Instant> => {
	const results: Array<Temporal.Instant> = [];
	const startedAt = Temporal.Now.instant();
	let checked = 0;
	rule.all((occZdt) => {
		checked += 1;
		const inst = Temporal.Instant.fromEpochMilliseconds(
			occZdt.epochMilliseconds,
		);
		// Occurrences come out in chronological order — once we're at/past the
		// end of the range nothing further can match, so stop entirely.
		if (Temporal.Instant.compare(inst, queryEnd) >= 0) {
			return false;
		}
		if (Temporal.Instant.compare(inst, queryStart) >= 0) {
			results.push(inst);
		}
		if (checked >= limits.maxOccurrencesChecked) {
			return false;
		}
		if (checked % TIME_CHECK_EVERY === 0) {
			const elapsedMs = startedAt.until(Temporal.Now.instant(), {
				largestUnit: "milliseconds",
			}).milliseconds;
			if (elapsedMs >= limits.timeBudgetMs) {
				return false;
			}
		}
		return true;
	});
	return results;
};

// ---------------------------------------------------------------------------
// hasOccurrenceInRange
// ---------------------------------------------------------------------------

/**
 * Returns the DTSTART instants of all master RRULE occurrences in
 * [queryStart, queryEnd).
 *
 * @param vcalRoot   The VCALENDAR root component — used to find RECURRENCE-ID
 *                   sibling overrides that should be excluded from the master.
 * @param vevent     The master recurring component (VEVENT / VTODO etc.).
 * @param queryStart Inclusive start of the query time range.
 * @param queryEnd   Exclusive end of the query time range.
 */
export const getOccurrenceInstantsInRange = (
	vcalRoot: IrComponent,
	vevent: IrComponent,
	queryStart: Temporal.Instant,
	queryEnd: Temporal.Instant,
	limits: RruleExpansionLimits = DEFAULT_RRULE_LIMITS,
): ReadonlyArray<Temporal.Instant> => {
	const rruleProp = vevent.properties.find((p) => p.name === "RRULE");
	if (!rruleProp || rruleProp.value.type !== "RECUR") {
		return [];
	}

	const dtstartProp = vevent.properties.find((p) => p.name === "DTSTART");
	const dtstart = dtstartProp
		? irSingleValueToJsZdt(dtstartProp.value)
		: undefined;

	const rruleString = normalizeRruleUntil(rruleProp.value.value, dtstart);

	const exDate: Array<JSTemporal.ZonedDateTime> = [];
	for (const prop of vevent.properties) {
		if (prop.name === "EXDATE") {
			exDate.push(...irDateListToJsZdts(prop.value));
		}
	}

	const uidValue = vevent.properties.find((p) => p.name === "UID")?.value;
	const uid = uidValue?.type === "TEXT" ? uidValue.value : undefined;
	if (uid !== undefined) {
		for (const sibling of vcalRoot.components) {
			if (sibling === vevent || sibling.name !== vevent.name) {
				continue;
			}
			const sibUid = sibling.properties.find((p) => p.name === "UID")?.value;
			if (sibUid?.type !== "TEXT" || sibUid.value !== uid) {
				continue;
			}
			const recIdProp = sibling.properties.find(
				(p) => p.name === "RECURRENCE-ID",
			);
			if (!recIdProp) {
				continue;
			}
			const jsZdt = irSingleValueToJsZdt(recIdProp.value);
			if (jsZdt) {
				exDate.push(jsZdt);
			}
		}
	}

	const rDate: Array<JSTemporal.ZonedDateTime> = [];
	for (const prop of vevent.properties) {
		if (prop.name === "RDATE") {
			rDate.push(...irDateListToJsZdts(prop.value));
		}
	}

	const baseRule = new RRuleTemporal({
		rruleString,
		...(dtstart !== undefined ? { dtstart } : {}),
	});
	const rule =
		exDate.length > 0 || rDate.length > 0
			? baseRule.with({
					...(exDate.length > 0 ? { exDate } : {}),
					...(rDate.length > 0 ? { rDate } : {}),
				})
			: baseRule;

	return boundedOccurrencesInRange(rule, queryStart, queryEnd, limits);
};

/**
 * Returns true if the master RRULE event has at least one occurrence in
 * [queryStart, queryEnd).
 *
 * @param vcalRoot   The VCALENDAR root component — used to find RECURRENCE-ID
 *                   sibling overrides that should be excluded from the master.
 * @param vevent     The master recurring component (VEVENT / VTODO etc.).
 * @param queryStart Inclusive start of the query time range.
 * @param queryEnd   Exclusive end of the query time range.
 */
export const hasOccurrenceInRange = (
	vcalRoot: IrComponent,
	vevent: IrComponent,
	queryStart: Temporal.Instant,
	queryEnd: Temporal.Instant,
	limits: RruleExpansionLimits = DEFAULT_RRULE_LIMITS,
): boolean =>
	getOccurrenceInstantsInRange(vcalRoot, vevent, queryStart, queryEnd, limits)
		.length > 0;
