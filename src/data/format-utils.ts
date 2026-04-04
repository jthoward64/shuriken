import { Temporal } from "temporal-polyfill";
import type { ContentLineParam } from "./content-line.ts";
import type { IrParameter, IrValue } from "./ir.ts";

// ---------------------------------------------------------------------------
// Text escaping (RFC 5545 §3.3.11 / RFC 6350 §4)
//
// Both iCalendar and vCard share identical backslash-escape rules:
//   \\ ↔ \    \, ↔ ,    \; ↔ ;    \n/\N → newline (encode as \n)
// ---------------------------------------------------------------------------

export const unescapeText = (raw: string): string =>
	raw.replace(/\\(\\|,|;|[nN])/g, (_, ch: string) => {
		if (ch === "n" || ch === "N") {
			return "\n";
		}
		return ch;
	});

export const escapeText = (value: string): string =>
	value
		.replace(/\\/g, "\\\\")
		.replace(/,/g, "\\,")
		.replace(/;/g, "\\;")
		.replace(/\n/g, "\\n");

/**
 * Split a TEXT value at unescaped commas and unescape each segment.
 * Used for TEXT_LIST properties (CATEGORIES, RESOURCES, NICKNAME, etc.).
 */
export const parseTextList = (raw: string): ReadonlyArray<string> => {
	const parts: Array<string> = [];
	let current = "";
	let escaped = false;
	for (const ch of raw) {
		if (escaped) {
			if (ch === "n" || ch === "N") {
				current += "\n";
			} else {
				current += ch;
			}
			escaped = false;
		} else if (ch === "\\") {
			escaped = true;
		} else if (ch === ",") {
			parts.push(current);
			current = "";
		} else {
			current += ch;
		}
	}
	parts.push(current);
	return parts;
};

/** Escape each item and join with "," for TEXT_LIST serialization. */
export const serializeTextList = (values: ReadonlyArray<string>): string =>
	values.map(escapeText).join(",");

// ---------------------------------------------------------------------------
// Date / time parsing helpers
// ---------------------------------------------------------------------------

const pad2 = (n: number): string => String(n).padStart(2, "0");
// biome-ignore lint/style/noMagicNumbers: Its fine, clear function for date padding. No need to define a constant
const pad4 = (n: number): string => String(n).padStart(4, "0");

// Regex for basic-format date "YYYYMMDD" or extended "YYYY-MM-DD"
const PLAIN_DATE_RE = /^(\d{4})-?(\d{2})-?(\d{2})$/;

/**
 * Parse "YYYYMMDD" or "YYYY-MM-DD" → Temporal.PlainDate.
 * Throws a descriptive string on bad input.
 */
export const parsePlainDate = (raw: string): Temporal.PlainDate => {
	const m = PLAIN_DATE_RE.exec(raw);
	if (m === null) {
		throw new Error(`Invalid date value: "${raw}"`);
	}
	const year = Number.parseInt(m[1] as string, 10);
	const month = Number.parseInt(m[2] as string, 10);
	const day = Number.parseInt(m[3] as string, 10);
	return Temporal.PlainDate.from({ year, month, day });
};

// Regex for basic/extended datetime: YYYYMMDDTHHMMSS[Z] or YYYY-MM-DDTHH:MM:SS[Z]
// Groups: 1=year, 2=month, 3=day, 4=hour, 5=minute, 6=second, 7="Z" (optional)
const DATE_TIME_RE =
	/^(\d{4})-?(\d{2})-?(\d{2})T(\d{2}):?(\d{2}):?(\d{2})(Z?)$/;

/**
 * Parse a datetime string and optional TZID parameter into a typed IrValue.
 *
 * Accepted forms (both iCalendar and vCard):
 *   "YYYYMMDDTHHMMSS"      → PLAIN_DATE_TIME (floating)
 *   "YYYYMMDDTHHMMSSZ"     → DATE_TIME (UTC ZonedDateTime)
 *   "YYYYMMDDTHHMMSS" + tzid param → DATE_TIME (named-tz ZonedDateTime)
 *   "YYYY-MM-DDTHH:MM:SS[Z]"       → same
 */
export const parseDateTimeString = (
	raw: string,
	tzid: string | undefined,
):
	| { readonly type: "DATE_TIME"; readonly value: Temporal.ZonedDateTime }
	| {
			readonly type: "PLAIN_DATE_TIME";
			readonly value: Temporal.PlainDateTime;
	  } => {
	const m = DATE_TIME_RE.exec(raw);
	if (m === null) {
		throw new Error(`Invalid datetime value: "${raw}"`);
	}
	const year = Number.parseInt(m[1] as string, 10);
	const month = Number.parseInt(m[2] as string, 10);
	const day = Number.parseInt(m[3] as string, 10);
	const hour = Number.parseInt(m[4] as string, 10);
	const minute = Number.parseInt(m[5] as string, 10);
	const second = Number.parseInt(m[6] as string, 10);
	const isUtc = m[7] === "Z";

	if (isUtc) {
		return {
			type: "DATE_TIME",
			value: Temporal.ZonedDateTime.from(
				`${pad4(year)}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}+00:00[UTC]`,
			),
		};
	}

	if (tzid) {
		return {
			type: "DATE_TIME",
			value: Temporal.ZonedDateTime.from(
				`${pad4(year)}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}[${tzid}]`,
			),
		};
	}

	return {
		type: "PLAIN_DATE_TIME",
		value: Temporal.PlainDateTime.from({
			year,
			month,
			day,
			hour,
			minute,
			second,
		}),
	};
};

/**
 * Parse a vCard "date-and-or-time" value (RFC 6350 §4.3.4).
 *
 * Maps to the most specific IrValue type possible:
 *   Full date   → { type: "DATE", value: PlainDate }
 *   Full datetime → { type: "DATE_TIME" | "PLAIN_DATE_TIME", value: ... }
 *   Partial (--MMDD, --MM-DD, time-only, etc.) → { type: "DATE_AND_OR_TIME", value: raw }
 */
export const parseDateAndOrTime = (raw: string): IrValue => {
	// Partial date: starts with "--"
	if (raw.startsWith("--")) {
		return { type: "DATE_AND_OR_TIME", value: raw };
	}
	// Time-only: starts with "T"
	if (raw.startsWith("T")) {
		return { type: "DATE_AND_OR_TIME", value: raw };
	}
	// Datetime: contains "T"
	if (raw.includes("T")) {
		try {
			return parseDateTimeString(raw, undefined);
		} catch {
			return { type: "DATE_AND_OR_TIME", value: raw };
		}
	}
	// Attempt to parse as a full date (YYYYMMDD or YYYY-MM-DD).
	// parsePlainDate throws on any non-matching input (year-month, etc.) → fall back to opaque.
	try {
		return { type: "DATE", value: parsePlainDate(raw) };
	} catch {
		return { type: "DATE_AND_OR_TIME", value: raw };
	}
};

// ---------------------------------------------------------------------------
// Date / time encoding helpers
// ---------------------------------------------------------------------------

/** Encode a PlainDate → "YYYYMMDD" (canonical basic format, no hyphens). */
export const formatPlainDate = (d: Temporal.PlainDate): string =>
	`${pad4(d.year)}${pad2(d.month)}${pad2(d.day)}`;

/**
 * Encode a ZonedDateTime:
 *   UTC timezone  → "YYYYMMDDTHHMMSSZ"
 *   other timezone → "YYYYMMDDTHHMMSS" (TZID param must be in IrProperty.parameters)
 */
export const formatZonedDateTime = (dt: Temporal.ZonedDateTime): string => {
	const d = `${pad4(dt.year)}${pad2(dt.month)}${pad2(dt.day)}`;
	const t = `T${pad2(dt.hour)}${pad2(dt.minute)}${pad2(dt.second)}`;
	const isUtc = dt.timeZoneId === "UTC";
	return isUtc ? `${d}${t}Z` : `${d}${t}`;
};

/** Encode a PlainDateTime → "YYYYMMDDTHHMMSS". */
export const formatPlainDateTime = (dt: Temporal.PlainDateTime): string => {
	const d = `${pad4(dt.year)}${pad2(dt.month)}${pad2(dt.day)}`;
	const t = `T${pad2(dt.hour)}${pad2(dt.minute)}${pad2(dt.second)}`;
	return `${d}${t}`;
};

// ---------------------------------------------------------------------------
// Parameter conversion
//
// ContentLineParam.values (ReadonlyArray<string>) ↔ IrParameter.value (string)
//
// The IrParameter stores the comma-joined value string, matching the single
// value column in dav_parameter. On encode we split back to restore the array.
// ---------------------------------------------------------------------------

/** ContentLineParam[] → IrParameter[]: join each param's values array with ",". */
export const paramsToIr = (
	params: ReadonlyArray<ContentLineParam>,
): ReadonlyArray<IrParameter> =>
	params.map((p) => ({ name: p.name, value: p.values.join(",") }));

/** IrParameter[] → ContentLineParam[]: split each value at "," to restore values. */
export const paramsFromIr = (
	params: ReadonlyArray<IrParameter>,
): ReadonlyArray<ContentLineParam> =>
	params.map((p) => ({
		name: p.name,
		values: p.value === "" ? [] : p.value.split(","),
	}));

// ---------------------------------------------------------------------------
// Parameter lookup helpers
// ---------------------------------------------------------------------------

/**
 * Return the first VALUE= param value from a content-line param list.
 * Matching is case-insensitive on the param name.
 */
export const getValueParam = (
	params: ReadonlyArray<ContentLineParam>,
): string | undefined => {
	const p = params.find((p) => p.name.toUpperCase() === "VALUE");
	return p?.values[0];
};

/**
 * Return the first TZID= param value from a content-line param list.
 * Matching is case-insensitive on the param name.
 */
export const getTzidParam = (
	params: ReadonlyArray<ContentLineParam>,
): string | undefined => {
	const p = params.find((p) => p.name.toUpperCase() === "TZID");
	return p?.values[0];
};
