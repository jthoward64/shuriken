import { Temporal } from "temporal-polyfill";

// ---------------------------------------------------------------------------
// Wire codec for the Postgres composite type `dav_datetime` (wall timestamp,
// zone text) stored as an array column for DATE_TIME_LIST property values.
//
// Each item is a local wall-clock plus an optional zone id: a ZonedDateTime
// when zoned (RFC 5545 Form 2 "Z" / Form 3 TZID) or a floating PlainDateTime
// (Form 1) when the zone is NULL. Reconstructing a ZonedDateTime from wall+zone
// is the faithful iCalendar reading of the value — and the only representation
// that admits floating items.
//
// postgres.js and PGlite both surface a composite-array column as the same raw
// Postgres text literal and accept the same on input, e.g.
//   {"(\"2023-11-05 01:00:00\",UTC)","(\"2024-11-03 01:00:00\",)"}
// so this codec maps that text ⇄ Temporal values with no driver-level type
// registration. Two quoting levels are in play: array elements use backslash
// escaping; composite record fields use doubled-quote ("") escaping.
// ---------------------------------------------------------------------------

/** Name of the Postgres composite type backing the array column. */
export const COMPOSITE_TYPE = "dav_datetime";

export type DatetimeListItem = Temporal.ZonedDateTime | Temporal.PlainDateTime;

interface WallZone {
	readonly wall: string;
	readonly zone: string | null;
}

const toWallZone = (item: DatetimeListItem): WallZone =>
	"timeZoneId" in item
		? { wall: item.toPlainDateTime().toString(), zone: item.timeZoneId }
		: { wall: item.toString(), zone: null };

const fromWallZone = ({ wall, zone }: WallZone): DatetimeListItem => {
	const plain = Temporal.PlainDateTime.from(wall);
	return zone === null ? plain : plain.toZonedDateTime(zone);
};

// --- serialize ---

/** Quote a composite record field (doubled-quote escaping). */
const quoteRecordField = (s: string): string =>
	`"${s.replace(/\\/g, "\\\\").replace(/"/g, '""')}"`;

/** A `(wall,zone)` record; a NULL zone is an empty (unquoted) trailing field. */
const serializeRecord = ({ wall, zone }: WallZone): string =>
	`(${quoteRecordField(wall)},${zone === null ? "" : quoteRecordField(zone)})`;

/** Quote an array element (backslash escaping). */
const quoteArrayElement = (record: string): string =>
	`"${record.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

export const serializeDatetimeArray = (
	items: ReadonlyArray<DatetimeListItem>,
): string =>
	`{${items
		.map((item) => quoteArrayElement(serializeRecord(toWallZone(item))))
		.join(",")}}`;

// --- parse ---

/** Split a `{...}` body into raw (still-quoted) elements at top-level commas. */
const splitArrayElements = (body: string): Array<string> => {
	const out: Array<string> = [];
	let cur = "";
	let inQuotes = false;
	let i = 0;
	while (i < body.length) {
		const c = body[i];
		if (inQuotes) {
			if (c === "\\") {
				cur += c + (body[i + 1] ?? "");
				i++;
			} else if (c === '"') {
				inQuotes = false;
				cur += c;
			} else {
				cur += c;
			}
		} else if (c === '"') {
			inQuotes = true;
			cur += c;
		} else if (c === ",") {
			out.push(cur);
			cur = "";
		} else {
			cur += c;
		}
		i++;
	}
	out.push(cur);
	return out;
};

/** Strip an array element's outer quotes and undo backslash escaping. */
const unquoteArrayElement = (el: string): string => {
	if (!(el.startsWith('"') && el.endsWith('"'))) {
		return el;
	}
	const inner = el.slice(1, -1);
	let out = "";
	let i = 0;
	while (i < inner.length) {
		const c = inner[i];
		if (c === "\\") {
			out += inner[i + 1] ?? "";
			i++;
		} else {
			out += c;
		}
		i++;
	}
	return out;
};

/** Split a record's inner `wall,zone` into fields, respecting "" quoting. */
const splitRecordFields = (inner: string): Array<string> => {
	const out: Array<string> = [];
	let cur = "";
	let inQuotes = false;
	let i = 0;
	while (i < inner.length) {
		const c = inner[i];
		if (inQuotes) {
			if (c === '"' && inner[i + 1] === '"') {
				cur += '""';
				i++;
			} else if (c === '"') {
				inQuotes = false;
				cur += c;
			} else {
				cur += c;
			}
		} else if (c === '"') {
			inQuotes = true;
			cur += c;
		} else if (c === ",") {
			out.push(cur);
			cur = "";
		} else {
			cur += c;
		}
		i++;
	}
	out.push(cur);
	return out;
};

/** Strip a record field's outer quotes and collapse doubled quotes. */
const unquoteRecordField = (f: string): string =>
	f.startsWith('"') && f.endsWith('"') && f.length >= 2
		? f.slice(1, -1).replace(/""/g, '"')
		: f;

const parseRecord = (record: string): WallZone => {
	const fields = splitRecordFields(record.slice(1, -1));
	const zoneRaw = fields[1] ?? "";
	return {
		wall: unquoteRecordField(fields[0] ?? ""),
		zone: zoneRaw.length === 0 ? null : unquoteRecordField(zoneRaw),
	};
};

/** Parse one array element (a record literal, possibly still array-quoted). */
const parseElement = (raw: string): DatetimeListItem =>
	fromWallZone(parseRecord(unquoteArrayElement(raw)));

/** Parse the full `{...}` composite-array text into items. */
export const parseDatetimeArray = (text: string): Array<DatetimeListItem> => {
	const body = text.slice(1, -1);
	if (body.length === 0) {
		return [];
	}
	return splitArrayElements(body).map(parseElement);
};

/**
 * Map a driver-returned value to items. Drivers disagree on the shape of a
 * composite-array column: postgres.js and raw PGlite return the full `{...}`
 * text, while the @effect/sql clients pre-split it into an array of record
 * literals. Accept both.
 */
export const parseDatetimeArrayValue = (
	value: string | ReadonlyArray<string>,
): Array<DatetimeListItem> =>
	typeof value === "string"
		? parseDatetimeArray(value)
		: value.map(parseElement);
