/** biome-ignore-all lint/style/noMagicNumbers: date/time padding lengths */
import { Temporal } from "temporal-polyfill";
import type { IrComponent, IrProperty } from "#src/data/ir.ts";
import type { TaskFormData } from "./types.ts";

// ---------------------------------------------------------------------------
// buildVtodoComponent — pure form → VTODO IR mapper.
//
// Date / datetime handling mirrors `buildVeventComponent` (cal-edit), with
// DTSTART/DUE in place of DTSTART/DTEND — both optional per RFC 5545 §3.6.2.
//
// COMPLETED is not form-owned: `completedAt` is supplied by the caller
// (service.live.ts), which knows whether this is a fresh completion (stamp
// now), a preserved prior completion (carry the existing value), or absent
// (task isn't COMPLETED, so omit it).
//
// RRULE: same `FREQ=…[;COUNT=…][;UNTIL=…]` shape as events.
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
	name: "DTSTART" | "DUE",
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

const buildIntProp = (name: string, raw: string): IrProperty | null => {
	if (raw === "") {
		return null;
	}
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n)) {
		return null;
	}
	return {
		name,
		parameters: [],
		value: { type: "INTEGER", value: n },
		isKnown: true,
	};
};

export const buildVtodoComponent = (
	uid: string,
	form: TaskFormData,
	completedAt: Temporal.ZonedDateTime | null,
): IrComponent | null => {
	if (form.summary === "") {
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
	];

	const dtstart = buildDtProp("DTSTART", form.start, form.allDay);
	if (dtstart) {
		props.push(dtstart);
	}
	const due = buildDtProp("DUE", form.due, form.allDay);
	if (due) {
		props.push(due);
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
	if (form.status !== "") {
		props.push(textProp("STATUS", form.status));
	}
	if (completedAt !== null) {
		props.push({
			name: "COMPLETED",
			parameters: [],
			value: { type: "DATE_TIME", value: completedAt },
			isKnown: true,
		});
	}
	const priority = buildIntProp("PRIORITY", form.priority);
	if (priority) {
		props.push(priority);
	}
	const percentComplete = buildIntProp(
		"PERCENT-COMPLETE",
		form.percentComplete,
	);
	if (percentComplete) {
		props.push(percentComplete);
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
		name: "VTODO",
		properties: props,
		components: [],
	};
};
