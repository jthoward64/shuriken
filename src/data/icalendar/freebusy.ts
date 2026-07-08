// ---------------------------------------------------------------------------
// Shared free-busy utilities used by:
//   - CALDAV:free-busy-query REPORT (RFC 4791 §7.10)
//   - Scheduling outbox POST free-busy request (RFC 6638 §5)
// ---------------------------------------------------------------------------

import { Temporal } from "temporal-polyfill";
import type { IrComponent } from "#src/data/ir.ts";

// RFC 5545 §3.1: fold threshold and continuation indent
const FOLD_LIMIT = 75;
const FOLD_CONTINUATION_LIMIT = 74;
const PAD2 = 2;
const PAD4 = 4;

// ---------------------------------------------------------------------------
// Free-busy period type — derived from TRANSP + STATUS
// ---------------------------------------------------------------------------

export type FbType = "BUSY" | "BUSY-TENTATIVE";

/** Returns null if the VEVENT should be considered FREE (transparent or cancelled). */
export const deriveFbType = (comp: IrComponent): FbType | null => {
	const transpProp = comp.properties.find((p) => p.name === "TRANSP");
	const transp =
		transpProp?.value.type === "TEXT" ? transpProp.value.value : "OPAQUE";

	if (transp === "TRANSPARENT") {
		return null;
	}

	const statusProp = comp.properties.find((p) => p.name === "STATUS");
	const status =
		statusProp?.value.type === "TEXT" ? statusProp.value.value : "CONFIRMED";

	if (status === "CANCELLED") {
		return null;
	}
	if (status === "TENTATIVE") {
		return "BUSY-TENTATIVE";
	}
	return "BUSY";
};

// ---------------------------------------------------------------------------
// Period — a time interval with a free-busy classification
// ---------------------------------------------------------------------------

export interface Period {
	start: Temporal.Instant;
	end: Temporal.Instant;
	fbType: FbType;
}

// ---------------------------------------------------------------------------
// Coalesce overlapping periods of the same FBTYPE
// ---------------------------------------------------------------------------

export const coalescePeriods = (
	periods: ReadonlyArray<Period>,
): Array<Period> => {
	const groups = new Map<
		FbType,
		Array<{ start: Temporal.Instant; end: Temporal.Instant }>
	>();
	for (const p of periods) {
		const group = groups.get(p.fbType) ?? [];
		group.push({ start: p.start, end: p.end });
		groups.set(p.fbType, group);
	}
	const result: Array<Period> = [];
	for (const [fbType, intervals] of groups) {
		intervals.sort(
			(a, b) => a.start.epochMilliseconds - b.start.epochMilliseconds,
		);
		let current: { start: Temporal.Instant; end: Temporal.Instant } | undefined;
		for (const iv of intervals) {
			if (!current) {
				current = { start: iv.start, end: iv.end };
			} else if (iv.start.epochMilliseconds <= current.end.epochMilliseconds) {
				if (iv.end.epochMilliseconds > current.end.epochMilliseconds) {
					current = { start: current.start, end: iv.end };
				}
			} else {
				result.push({ ...current, fbType });
				current = { start: iv.start, end: iv.end };
			}
		}
		if (current) {
			result.push({ ...current, fbType });
		}
	}
	result.sort((a, b) => a.start.epochMilliseconds - b.start.epochMilliseconds);
	return result;
};

// ---------------------------------------------------------------------------
// Format Instant as iCalendar UTC datetime string (e.g. 20060102T150405Z)
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(PAD2, "0");
const pad4 = (n: number) => String(n).padStart(PAD4, "0");

export const formatUtcDt = (instant: Temporal.Instant): string => {
	const d = instant.toZonedDateTimeISO("UTC");
	return `${pad4(d.year)}${pad2(d.month)}${pad2(d.day)}T${pad2(d.hour)}${pad2(d.minute)}${pad2(d.second)}Z`;
};

// ---------------------------------------------------------------------------
// RFC 5545 §3.1: fold lines > 75 octets with CRLF + SP
// ---------------------------------------------------------------------------

export const foldLine = (line: string): string => {
	if (line.length <= FOLD_LIMIT) {
		return line;
	}
	let result = "";
	let remaining = line;
	let first = true;
	while (remaining.length > 0) {
		const limit = first ? FOLD_LIMIT : FOLD_CONTINUATION_LIMIT;
		result += `${first ? "" : "\r\n "}${remaining.slice(0, limit)}`;
		remaining = remaining.slice(limit);
		first = false;
	}
	return result;
};

// ---------------------------------------------------------------------------
// Build VFREEBUSY iCalendar text
// ---------------------------------------------------------------------------

export const buildVfreebusyText = (
	queryStart: Temporal.Instant,
	queryEnd: Temporal.Instant,
	periods: ReadonlyArray<Period>,
): string => {
	const dtstamp = formatUtcDt(Temporal.Now.instant());

	const lines: Array<string> = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//shuriken-ts//CalDAV//EN",
		"BEGIN:VFREEBUSY",
		`DTSTAMP:${dtstamp}`,
		`DTSTART:${formatUtcDt(queryStart)}`,
		`DTEND:${formatUtcDt(queryEnd)}`,
	];

	for (const p of periods) {
		const period = `${formatUtcDt(p.start)}/${formatUtcDt(p.end)}`;
		if (p.fbType === "BUSY") {
			lines.push(`FREEBUSY:${period}`);
		} else {
			lines.push(`FREEBUSY;FBTYPE=${p.fbType}:${period}`);
		}
	}

	lines.push("END:VFREEBUSY", "END:VCALENDAR");
	return `${lines.map(foldLine).join("\r\n")}\r\n`;
};

// ---------------------------------------------------------------------------
// Parse a PERIOD string (RFC 5545 §3.3.9) to { start, end } Instants.
// Format: <date-time>/<date-time>  OR  <date-time>/<duration>
// Returns undefined for floating times or parse failures.
// ---------------------------------------------------------------------------

export const parsePeriodString = (
	s: string,
): { start: Temporal.Instant; end: Temporal.Instant } | undefined => {
	const slash = s.indexOf("/");
	if (slash === -1) {
		return undefined;
	}
	const startStr = s.slice(0, slash);
	const endStr = s.slice(slash + 1);
	try {
		const start = Temporal.Instant.from(startStr);
		if (endStr.startsWith("P") || endStr.startsWith("-P")) {
			const end = start.add(Temporal.Duration.from(endStr));
			return { start, end };
		}
		const end = Temporal.Instant.from(endStr);
		return { start, end };
	} catch {
		return undefined;
	}
};
