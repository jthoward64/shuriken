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

	const occurrences = rule.between(
		new Date(queryStart.epochMilliseconds - 1),
		new Date(queryEnd.epochMilliseconds),
		false,
	);
	return occurrences.map((d) =>
		Temporal.Instant.fromEpochMilliseconds(d.epochMilliseconds),
	);
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
): boolean => {
	// 1. RRULE text (type RECUR)
	const rruleProp = vevent.properties.find((p) => p.name === "RRULE");
	if (!rruleProp || rruleProp.value.type !== "RECUR") {
		return false;
	}

	// 2. DTSTART → @js-temporal/polyfill ZonedDateTime (needed to interpret a
	//    naive UNTIL in the event's timezone).
	const dtstartProp = vevent.properties.find((p) => p.name === "DTSTART");
	const dtstart = dtstartProp
		? irSingleValueToJsZdt(dtstartProp.value)
		: undefined;

	const rruleString = normalizeRruleUntil(rruleProp.value.value, dtstart);

	// 3a. exDate from EXDATE properties
	const exDate: Array<JSTemporal.ZonedDateTime> = [];
	for (const prop of vevent.properties) {
		if (prop.name === "EXDATE") {
			exDate.push(...irDateListToJsZdts(prop.value));
		}
	}

	// 3b. exDate += RECURRENCE-ID values from sibling override components
	//     (overrides replace those slots; the master must skip them)
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

	// 4. rDate from RDATE properties
	const rDate: Array<JSTemporal.ZonedDateTime> = [];
	for (const prop of vevent.properties) {
		if (prop.name === "RDATE") {
			rDate.push(...irDateListToJsZdts(prop.value));
		}
	}

	// 5. Build RRuleTemporal from the RRULE string, then attach exDate / rDate
	//    via .with() (IcsOpts doesn't expose exDate/rDate directly).
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

	// 6. between(after, before, inc=false) is exclusive on both ends.
	//    We want [queryStart, queryEnd), so subtract 1ms from after to make
	//    queryStart inclusive.
	const occurrences = rule.between(
		new Date(queryStart.epochMilliseconds - 1),
		new Date(queryEnd.epochMilliseconds),
		false,
	);
	return occurrences.length > 0;
};
