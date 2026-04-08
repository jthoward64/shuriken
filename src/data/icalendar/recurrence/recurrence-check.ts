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
import type { Temporal } from "temporal-polyfill";
import type { IrComponent, IrValue } from "#src/data/ir.ts";

// ---------------------------------------------------------------------------
// Helpers: convert temporal-polyfill values → @js-temporal/polyfill via strings
// ---------------------------------------------------------------------------

/** Single date/time IrValue → @js-temporal/polyfill ZonedDateTime, or undefined. */
const irSingleValueToJsZdt = (v: IrValue): JSTemporal.ZonedDateTime | undefined => {
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
		return v.value.map((zdt) => JSTemporal.ZonedDateTime.from(zdt.toString()));
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

// ---------------------------------------------------------------------------
// hasOccurrenceInRange
// ---------------------------------------------------------------------------

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
	const rruleString = rruleProp.value.value;

	// 2. DTSTART → @js-temporal/polyfill ZonedDateTime
	const dtstartProp = vevent.properties.find((p) => p.name === "DTSTART");
	const dtstart = dtstartProp ? irSingleValueToJsZdt(dtstartProp.value) : undefined;

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
			const recIdProp = sibling.properties.find((p) => p.name === "RECURRENCE-ID");
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
