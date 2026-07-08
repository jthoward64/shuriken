/** biome-ignore-all lint/style/noMagicNumbers: date/time substring indices */
import type { IrComponent, IrProperty } from "#src/data/ir.ts";
import type { RecurrenceFreq } from "#src/services/cal-edit/types.ts";
import type { TaskFormData, TaskStatus } from "./types.ts";
import { emptyTaskForm } from "./types.ts";

// ---------------------------------------------------------------------------
// parseVtodoToForm — inverse of `buildVtodoComponent`. Drops unknown
// properties (ATTACH, ATTENDEE, ALARM, …); the live service preserves them by
// carrying the original IrComponent through the edit cycle and only replacing
// the props this form actually owns.
// ---------------------------------------------------------------------------

const textOf = (p: IrProperty): string =>
	p.value.type === "TEXT" ||
	p.value.type === "URI" ||
	p.value.type === "CAL_ADDRESS"
		? p.value.value
		: "";

const isAllDayProp = (p: IrProperty): boolean =>
	p.parameters.some((pp) => pp.name === "VALUE" && pp.value === "DATE") ||
	p.value.type === "DATE";

const isoForProp = (p: IrProperty): string => {
	if (p.value.type === "DATE") {
		return p.value.value.toString();
	}
	if (p.value.type === "PLAIN_DATE_TIME") {
		// HTML datetime-local format: YYYY-MM-DDTHH:mm
		const dt = p.value.value;
		const pad = (n: number) => String(n).padStart(2, "0");
		return `${dt.year.toString().padStart(4, "0")}-${pad(dt.month)}-${pad(dt.day)}T${pad(dt.hour)}:${pad(dt.minute)}`;
	}
	if (p.value.type === "DATE_TIME") {
		const dt = p.value.value.toPlainDateTime();
		const pad = (n: number) => String(n).padStart(2, "0");
		return `${dt.year.toString().padStart(4, "0")}-${pad(dt.month)}-${pad(dt.day)}T${pad(dt.hour)}:${pad(dt.minute)}`;
	}
	return textOf(p);
};

const parseRruleString = (
	value: string,
): { freq: RecurrenceFreq; count: string; until: string } => {
	const parts = value.split(";");
	let freq: RecurrenceFreq = "";
	let count = "";
	let until = "";
	for (const part of parts) {
		const [k, v] = part.split("=", 2);
		if (k === "FREQ" && v !== undefined) {
			const upper = v.toUpperCase();
			if (
				upper === "DAILY" ||
				upper === "WEEKLY" ||
				upper === "MONTHLY" ||
				upper === "YEARLY"
			) {
				freq = upper;
			}
		} else if (k === "COUNT" && v !== undefined) {
			count = v;
		} else if (k === "UNTIL" && v !== undefined) {
			// `YYYYMMDD` → `YYYY-MM-DD`; `YYYYMMDDTHHMMSSZ` → strip suffix and use
			// just the date for the form input (UI doesn't expose datetime UNTIL).
			until = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
		}
	}
	return { freq, count, until };
};

const VALID_STATUSES: ReadonlySet<string> = new Set([
	"NEEDS-ACTION",
	"IN-PROCESS",
	"COMPLETED",
	"CANCELLED",
]);

export const parseVtodoToForm = (vtodo: IrComponent): TaskFormData => {
	let summary = "";
	let description = "";
	let location = "";
	let categoriesCsv = "";
	let allDay = false;
	let start = "";
	let due = "";
	let status: TaskStatus = "";
	let priority = "";
	let percentComplete = "";
	let recurrenceFreq: RecurrenceFreq = "";
	let recurrenceCount = "";
	let recurrenceUntil = "";

	for (const p of vtodo.properties) {
		switch (p.name) {
			case "SUMMARY":
				summary = textOf(p);
				break;
			case "DESCRIPTION":
				description = textOf(p);
				break;
			case "LOCATION":
				location = textOf(p);
				break;
			case "CATEGORIES":
				if (p.value.type === "TEXT_LIST") {
					categoriesCsv = [...p.value.value].join(", ");
				} else {
					categoriesCsv = textOf(p);
				}
				break;
			case "DTSTART":
				allDay = isAllDayProp(p);
				start = isoForProp(p);
				break;
			case "DUE":
				// DUE governs allDay when DTSTART is absent.
				if (start === "") {
					allDay = isAllDayProp(p);
				}
				due = isoForProp(p);
				break;
			case "STATUS": {
				const raw = textOf(p).toUpperCase();
				status = VALID_STATUSES.has(raw) ? (raw as TaskStatus) : "";
				break;
			}
			case "PRIORITY":
				priority =
					p.value.type === "INTEGER" ? String(p.value.value) : textOf(p);
				break;
			case "PERCENT-COMPLETE":
				percentComplete =
					p.value.type === "INTEGER" ? String(p.value.value) : textOf(p);
				break;
			case "RRULE": {
				const raw = p.value.type === "RECUR" ? p.value.value : textOf(p);
				const parsed = parseRruleString(raw);
				recurrenceFreq = parsed.freq;
				recurrenceCount = parsed.count;
				recurrenceUntil = parsed.until;
				break;
			}
			default:
				break;
		}
	}

	return {
		...emptyTaskForm,
		summary,
		description,
		location,
		categoriesCsv,
		allDay,
		start,
		due,
		status,
		priority,
		percentComplete,
		recurrenceFreq,
		recurrenceCount,
		recurrenceUntil,
	};
};
