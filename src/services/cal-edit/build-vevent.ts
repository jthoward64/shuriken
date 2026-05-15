/** biome-ignore-all lint/style/noMagicNumbers: date/time padding lengths */
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
// RRULE: builds a simple `FREQ=…[;COUNT=…][;UNTIL=…]` string. UNTIL is
// rendered as the iCalendar basic format (`YYYYMMDDTHHMMSSZ` for date-times,
// `YYYYMMDD` for dates). UI exposes only FREQ + a single bound.
// ---------------------------------------------------------------------------

const textProp = (name: string, value: string): IrProperty => ({
	name,
	parameters: [],
	value: { type: "TEXT", value },
	isKnown: true,
});

const tryPlainDate = (raw: string): Temporal.PlainDate | null => {
	try {
		return Temporal.PlainDate.from(raw);
	} catch {
		return null;
	}
};

const tryPlainDateTime = (raw: string): Temporal.PlainDateTime | null => {
	try {
		return Temporal.PlainDateTime.from(raw);
	} catch {
		return null;
	}
};

const formatRruleUntil = (raw: string, allDay: boolean): string | null => {
	if (raw === "") {
		return null;
	}
	if (allDay) {
		const d = tryPlainDate(raw);
		if (!d) {
			return null;
		}
		return `${d.year.toString().padStart(4, "0")}${String(d.month).padStart(2, "0")}${String(d.day).padStart(2, "0")}`;
	}
	const dt = tryPlainDateTime(raw);
	if (!dt) {
		return null;
	}
	const date = `${dt.year.toString().padStart(4, "0")}${String(dt.month).padStart(2, "0")}${String(dt.day).padStart(2, "0")}`;
	const time = `${String(dt.hour).padStart(2, "0")}${String(dt.minute).padStart(2, "0")}${String(dt.second).padStart(2, "0")}`;
	return `${date}T${time}Z`;
};

const buildDtProp = (
	name: "DTSTART" | "DTEND",
	raw: string,
	allDay: boolean,
): IrProperty | null => {
	if (raw === "") {
		return null;
	}
	if (allDay) {
		const d = tryPlainDate(raw);
		if (!d) {
			return null;
		}
		return {
			name,
			parameters: [{ name: "VALUE", value: "DATE" }],
			value: { type: "DATE", value: d },
			isKnown: true,
		};
	}
	const dt = tryPlainDateTime(raw);
	if (!dt) {
		return null;
	}
	return {
		name,
		parameters: [],
		value: { type: "PLAIN_DATE_TIME", value: dt },
		isKnown: true,
	};
};

export const buildVeventComponent = (
	uid: string,
	form: EventFormData,
): IrComponent | null => {
	const dtstart = buildDtProp("DTSTART", form.start, form.allDay);
	if (!dtstart) {
		return null;
	}
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
	const dtend = buildDtProp("DTEND", form.end, form.allDay);
	if (dtend) {
		props.push(dtend);
	}
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
			const until = formatRruleUntil(form.recurrenceUntil, form.allDay);
			if (until !== null) {
				parts.push(`UNTIL=${until}`);
			}
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
