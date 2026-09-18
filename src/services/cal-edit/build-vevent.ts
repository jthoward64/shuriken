/** biome-ignore-all lint/style/noMagicNumbers: date/time padding lengths */
import { Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type { IrComponent, IrProperty } from "#src/data/ir.ts";
import type { EventFormData } from "./types.ts";

// ---------------------------------------------------------------------------
// buildVeventComponent — pure form → VEVENT IR mapper.
//
// Date / datetime handling:
//   * allDay   → DTSTART;VALUE=DATE / DTEND;VALUE=DATE (PlainDate)
//   * timed    → DTSTART / DTEND as PLAIN_DATE_TIME (floating local) — the
//                caller decides whether to wrap in a VTIMEZONE later. Keeping
//                events floating works for personal-use single-server flows.
//
// RRULE: builds a simple `FREQ=…[;COUNT=…][;UNTIL=…]` string. UNTIL mirrors
// DTSTART's form (`YYYYMMDD` for dates, floating `YYYYMMDDTHHMMSS` for
// date-times). UI exposes only FREQ + a single bound.
// ---------------------------------------------------------------------------

const textProp = (name: string, value: string): IrProperty => ({
	name,
	parameters: [],
	value: { type: "TEXT", value },
	isKnown: true,
});

/** Parses an ISO date, absent when the value is not a valid calendar date */
const plainDateFrom = Option.liftThrowable((raw: string) =>
	Temporal.PlainDate.from(raw),
);

/** Parses a floating ISO date-time, absent when the value is not a valid one */
const plainDateTimeFrom = Option.liftThrowable((raw: string) =>
	Temporal.PlainDateTime.from(raw),
);

/**
 * Formats the RRULE UNTIL value to match DTSTART's form.
 *
 * RFC 5545 section 3.3.10: UNTIL must have the same value type as DTSTART, and
 * "if the DTSTART property is specified as a date with local time, then the
 * UNTIL rule part MUST also be specified as a date with local time". `buildDtProp`
 * below emits DTSTART as a DATE for all-day and as floating local time
 * otherwise, so UNTIL follows: a bare date, or a local date-time with no `Z`.
 *
 * Appending `Z` here would make UNTIL an instant while DTSTART stayed floating,
 * which shifts the end of the series by each reader's UTC offset and can add or
 * drop the final occurrence.
 */
const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

const formatRruleUntil = (
	raw: string,
	allDay: boolean,
): Option.Option<string> => {
	if (raw === "") {
		return Option.none();
	}
	if (allDay) {
		return Option.map(
			plainDateFrom(raw),
			(d) => `${pad(d.year, 4)}${pad(d.month)}${pad(d.day)}`,
		);
	}
	return Option.map(
		plainDateTimeFrom(raw),
		(dt) =>
			`${pad(dt.year, 4)}${pad(dt.month)}${pad(dt.day)}T${pad(dt.hour)}${pad(dt.minute)}${pad(dt.second)}`,
	);
};

const buildDtProp = (
	name: "DTSTART" | "DTEND",
	raw: string,
	allDay: boolean,
): Option.Option<IrProperty> => {
	if (raw === "") {
		return Option.none();
	}
	if (allDay) {
		return Option.map(plainDateFrom(raw), (d) => ({
			name,
			parameters: [{ name: "VALUE", value: "DATE" }],
			value: { type: "DATE" as const, value: d },
			isKnown: true,
		}));
	}
	return Option.map(plainDateTimeFrom(raw), (dt) => ({
		name,
		parameters: [],
		value: { type: "PLAIN_DATE_TIME" as const, value: dt },
		isKnown: true,
	}));
};

export const buildVeventComponent = (
	uid: string,
	form: EventFormData,
): Option.Option<IrComponent> =>
	Option.map(buildDtProp("DTSTART", form.start, form.allDay), (dtstart) =>
		assembleVevent(uid, form, dtstart),
	);

/** Assembles the VEVENT body once DTSTART has been accepted. */
const assembleVevent = (
	uid: string,
	form: EventFormData,
	dtstart: IrProperty,
): IrComponent => {
	const props: Array<IrProperty> = [
		{
			name: "UID",
			parameters: [],
			value: { type: "TEXT", value: uid },
			isKnown: true,
		},
		textProp("SUMMARY", form.summary),
		dtstart,
	];
	props.push(...Option.toArray(buildDtProp("DTEND", form.end, form.allDay)));
	if (form.description !== "") {
		props.push(textProp("DESCRIPTION", form.description));
	}
	if (form.location !== "") {
		props.push(textProp("LOCATION", form.location));
	}
	const categories = form.categoriesCsv
		.split(",")
		.map((c) => c.trim())
		.filter((c) => c !== "");
	if (categories.length > 0) {
		props.push({
			name: "CATEGORIES",
			parameters: [],
			value: { type: "TEXT_LIST", value: categories },
			isKnown: true,
		});
	}
	if (form.organizer !== "") {
		props.push({
			name: "ORGANIZER",
			parameters: [],
			value: { type: "CAL_ADDRESS", value: `mailto:${form.organizer}` },
			isKnown: true,
		});
	}
	for (const a of form.attendees) {
		const trimmed = a.trim();
		if (trimmed === "") {
			continue;
		}
		props.push({
			name: "ATTENDEE",
			parameters: [
				{ name: "ROLE", value: "REQ-PARTICIPANT" },
				{ name: "PARTSTAT", value: "NEEDS-ACTION" },
				{ name: "RSVP", value: "TRUE" },
			],
			value: { type: "CAL_ADDRESS", value: `mailto:${trimmed}` },
			isKnown: true,
		});
	}

	if (form.recurrenceFreq !== "") {
		const parts: Array<string> = [`FREQ=${form.recurrenceFreq}`];
		const count = Number.parseInt(form.recurrenceCount, 10);
		if (Number.isFinite(count) && count > 0) {
			parts.push(`COUNT=${count}`);
		} else {
			parts.push(
				...Option.toArray(
					Option.map(
						formatRruleUntil(form.recurrenceUntil, form.allDay),
						(until) => `UNTIL=${until}`,
					),
				),
			);
		}
		props.push({
			name: "RRULE",
			parameters: [],
			value: { type: "RECUR", value: parts.join(";") },
			isKnown: true,
		});
	}

	return {
		name: "VEVENT",
		properties: props,
		components: [],
	};
};
