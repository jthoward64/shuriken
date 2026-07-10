// ---------------------------------------------------------------------------
// iCalendar filter parsing and evaluation — RFC 4791 §9.7–9.9
//
// Parses <CALDAV:filter> elements and evaluates them against an IrDocument.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import {
	effectiveDtend,
	getDtendInstant,
	getDtstartInstant,
	getDtstartProp,
	instantFromIrValue,
} from "#src/data/icalendar/ir-helpers.ts";
import {
	DEFAULT_RRULE_LIMITS,
	hasOccurrenceInRange,
	type RruleExpansionLimits,
} from "#src/data/icalendar/recurrence/recurrence-check.ts";
import type { IrComponent, IrDocument, IrProperty } from "#src/data/ir.ts";
import type { DavError } from "#src/domain/errors.ts";
import { forbidden } from "#src/domain/errors.ts";

const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
const cn = (local: string): string => `{${CALDAV_NS}}${local}`;

// Bounds for an open-ended <time-range> (a missing start or end). Temporal
// cannot represent Number.MAX_SAFE_INTEGER milliseconds — it exceeds the maximum
// instant (~year 275760) and throws "Out-of-bounds date" — and expanding a
// no-UNTIL recurrence all the way to that limit would generate hundreds of
// thousands of occurrences. Year 1..9999 is a safe, practical infinity: no real
// calendar object recurs outside it.
const OPEN_RANGE_START = Temporal.Instant.from("0001-01-01T00:00:00Z");
const OPEN_RANGE_END = Temporal.Instant.from("9999-12-31T23:59:59Z");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TextMatch {
	readonly value: string;
	readonly collation: "i;ascii-casemap" | "i;unicode-casemap" | "i;octet";
	readonly matchType: "equals" | "contains" | "starts-with" | "ends-with";
	readonly negate: boolean;
}

export interface ParamFilter {
	readonly name: string;
	readonly isNotDefined?: boolean;
	readonly textMatch?: TextMatch;
}

export interface PropFilter {
	readonly name: string;
	readonly isNotDefined?: boolean;
	readonly timeRange?: { start?: Temporal.Instant; end?: Temporal.Instant };
	readonly textMatch?: TextMatch;
	readonly paramFilters: ReadonlyArray<ParamFilter>;
}

export interface CompFilter {
	readonly name: string;
	readonly isNotDefined?: boolean;
	readonly timeRange?: { start?: Temporal.Instant; end?: Temporal.Instant };
	readonly propFilters: ReadonlyArray<PropFilter>;
	readonly compFilters: ReadonlyArray<CompFilter>;
}

export interface CalFilter {
	readonly compFilter: CompFilter;
}

// ---------------------------------------------------------------------------
// parseCalFilter
// ---------------------------------------------------------------------------

export const parseCalFilter = (
	tree: unknown,
): Effect.Effect<CalFilter, DavError> => {
	if (typeof tree !== "object" || tree === null) {
		return Effect.fail(forbidden("CALDAV:valid-filter"));
	}
	const obj = tree as Record<string, unknown>;
	const filterEl = obj[cn("filter")];
	if (typeof filterEl !== "object" || filterEl === null) {
		return Effect.fail(forbidden("CALDAV:valid-filter"));
	}
	const compEl = (filterEl as Record<string, unknown>)[cn("comp-filter")];
	if (!compEl) {
		return Effect.fail(forbidden("CALDAV:valid-filter"));
	}
	return Effect.succeed({ compFilter: parseCompFilter(compEl) });
};

const parseCompFilter = (el: unknown): CompFilter => {
	if (typeof el !== "object" || el === null) {
		return { name: "", isNotDefined: false, propFilters: [], compFilters: [] };
	}
	const obj = el as Record<string, unknown>;
	const name = typeof obj["@_name"] === "string" ? obj["@_name"] : "";
	const isNotDefined = cn("is-not-defined") in obj;
	const timeRange = parseTimeRange(obj[cn("time-range")]);

	const propFilters = parseChildren(obj[cn("prop-filter")], parsePropFilter);
	const compFilters = parseChildren(obj[cn("comp-filter")], parseCompFilter);

	return { name, isNotDefined, timeRange, propFilters, compFilters };
};

const parsePropFilter = (el: unknown): PropFilter => {
	if (typeof el !== "object" || el === null) {
		return { name: "", paramFilters: [] };
	}
	const obj = el as Record<string, unknown>;
	const name = typeof obj["@_name"] === "string" ? obj["@_name"] : "";
	const isNotDefined = cn("is-not-defined") in obj;
	const timeRange = parseTimeRange(obj[cn("time-range")]);
	const textMatch = parseTextMatch(obj[cn("text-match")]);
	const paramFilters = parseChildren(obj[cn("param-filter")], parseParamFilter);
	return { name, isNotDefined, timeRange, textMatch, paramFilters };
};

const parseParamFilter = (el: unknown): ParamFilter => {
	if (typeof el !== "object" || el === null) {
		return { name: "" };
	}
	const obj = el as Record<string, unknown>;
	const name = typeof obj["@_name"] === "string" ? obj["@_name"] : "";
	const isNotDefined = cn("is-not-defined") in obj;
	const textMatch = parseTextMatch(obj[cn("text-match")]);
	return { name, isNotDefined, textMatch };
};

const parseTextMatch = (el: unknown): TextMatch | undefined => {
	if (el === undefined || el === null) {
		return undefined;
	}
	// fast-xml-parser collapses a text-only element with no attributes —
	// `<C:text-match>foo</C:text-match>`, the form most clients (python-caldav,
	// iOS, …) send — to a bare string or number, and only produces an object
	// (with `#text`) when the element carries attributes like collation or
	// match-type. Handle every shape, otherwise the text-match is silently
	// dropped and the prop-filter degrades to a mere property-existence check.
	if (typeof el === "string" || typeof el === "number") {
		return {
			value: String(el),
			collation: "i;ascii-casemap",
			matchType: "contains",
			negate: false,
		};
	}
	if (typeof el !== "object") {
		return undefined;
	}
	const obj = el as Record<string, unknown>;
	const rawText = obj["#text"];
	const value =
		typeof rawText === "string"
			? rawText
			: typeof rawText === "number"
				? String(rawText)
				: "";
	const rawCollation = obj["@_collation"];
	const collation: TextMatch["collation"] =
		rawCollation === "i;unicode-casemap"
			? "i;unicode-casemap"
			: rawCollation === "i;octet"
				? "i;octet"
				: "i;ascii-casemap";
	const matchType = (
		["equals", "contains", "starts-with", "ends-with"].includes(
			obj["@_match-type"] as string,
		)
			? obj["@_match-type"]
			: "contains"
	) as TextMatch["matchType"];
	const negate = obj["@_negate-condition"] === "yes";
	return { value, collation, matchType, negate };
};

const tryParseInstant = (s: string): Temporal.Instant | undefined => {
	try {
		return Temporal.Instant.from(s);
	} catch {
		return undefined;
	}
};

const parseTimeRange = (
	el: unknown,
): { start?: Temporal.Instant; end?: Temporal.Instant } | undefined => {
	if (typeof el !== "object" || el === null) {
		return undefined;
	}
	const obj = el as Record<string, unknown>;
	const start =
		typeof obj["@_start"] === "string"
			? tryParseInstant(obj["@_start"])
			: undefined;
	const end =
		typeof obj["@_end"] === "string"
			? tryParseInstant(obj["@_end"])
			: undefined;
	if (!start && !end) {
		return undefined;
	}
	return { start, end };
};

const parseChildren = <T>(
	el: unknown,
	parse: (el: unknown) => T,
): ReadonlyArray<T> => {
	if (!el) {
		return [];
	}
	const arr = Array.isArray(el) ? el : [el];
	return arr.map(parse);
};

// ---------------------------------------------------------------------------
// evaluateCalFilter
// ---------------------------------------------------------------------------

export const evaluateCalFilter = (
	doc: IrDocument,
	filter: CalFilter,
	limits: RruleExpansionLimits = DEFAULT_RRULE_LIMITS,
): boolean => evalCompFilter(doc.root, filter.compFilter, doc.root, limits);

const evalCompFilter = (
	comp: IrComponent,
	f: CompFilter,
	vcalRoot: IrComponent,
	limits: RruleExpansionLimits,
	// The component enclosing `comp`, when there is one. Needed to evaluate a
	// VALARM time-range, whose TRIGGER is relative to its parent component.
	parent?: IrComponent,
): boolean => {
	if (f.name !== comp.name) {
		// comp-filter applies to a different component name — look in children
		return comp.components.some((child) =>
			evalCompFilter(child, f, vcalRoot, limits, comp),
		);
	}

	if (f.isNotDefined) {
		// is-not-defined: the component should NOT be present — since we're here, it is present, so this fails
		return false;
	}

	// Time-range filter on the component
	if (
		f.timeRange &&
		!evalComponentTimeRange(comp, f.timeRange, vcalRoot, limits, parent)
	) {
		return false;
	}

	// Prop filters
	for (const pf of f.propFilters) {
		if (!evalPropFilter(comp, pf)) {
			return false;
		}
	}

	// Nested comp filters
	for (const cf of f.compFilters) {
		const matchingChildren = comp.components.filter((c) => c.name === cf.name);
		if (cf.isNotDefined) {
			if (matchingChildren.length > 0) {
				return false;
			}
		} else if (
			!matchingChildren.some((c) =>
				evalCompFilter(c, cf, vcalRoot, limits, comp),
			)
		) {
			return false;
		}
	}

	return true;
};

const evalPropFilter = (comp: IrComponent, f: PropFilter): boolean => {
	const props = comp.properties.filter((p) => p.name === f.name);

	if (f.isNotDefined) {
		return props.length === 0;
	}
	if (props.length === 0) {
		return false;
	}

	return props.some((prop) => {
		if (f.timeRange) {
			const instant = instantFromIrValue(prop);
			if (!instant) {
				return false;
			} // floating time, no timezone → no match
			const { start, end } = f.timeRange;
			if (start && instant.epochMilliseconds < start.epochMilliseconds) {
				return false;
			}
			if (end && instant.epochMilliseconds >= end.epochMilliseconds) {
				return false;
			}
		}
		if (f.textMatch && !evalTextMatch(propValueText(prop), f.textMatch)) {
			return false;
		}
		for (const pf of f.paramFilters) {
			if (!evalParamFilter(prop, pf)) {
				return false;
			}
		}
		return true;
	});
};

const evalParamFilter = (prop: IrProperty, f: ParamFilter): boolean => {
	const params = prop.parameters.filter(
		(p) => p.name.toUpperCase() === f.name.toUpperCase(),
	);
	if (f.isNotDefined) {
		return params.length === 0;
	}
	if (params.length === 0) {
		return false;
	}
	if (f.textMatch) {
		const tm = f.textMatch;
		return params.some((p) => evalTextMatch(p.value, tm));
	}
	return true;
};

const evalTextMatch = (text: string, tm: TextMatch): boolean => {
	// RFC 4791 §7.5.1: i;ascii-casemap and i;octet are mandatory. The casemap
	// collations fold case; i;octet is an exact byte/codepoint comparison
	// (case-sensitive), which clients rely on for e.g. an exact CATEGORIES match.
	const fold = (s: string) => {
		switch (tm.collation) {
			case "i;octet":
				return s;
			case "i;unicode-casemap":
				return s.normalize("NFC").toLowerCase();
			default:
				return s.toLowerCase();
		}
	};
	const haystack = fold(text);
	const needle = fold(tm.value);

	let matches: boolean;
	switch (tm.matchType) {
		case "equals":
			matches = haystack === needle;
			break;
		case "contains":
			matches = haystack.includes(needle);
			break;
		case "starts-with":
			matches = haystack.startsWith(needle);
			break;
		case "ends-with":
			matches = haystack.endsWith(needle);
			break;
	}
	return tm.negate ? !matches : matches;
};

/**
 * VTODO time-range matching — RFC 4791 §9.9 rule table (full 8-row implementation).
 *
 * +-------+------+-----+-----------+---------+-------------------------------------------+
 * |DTSTART|DURATN| DUE | COMPLETED | CREATED | Condition                                 |
 * +-------+------+-----+-----------+---------+-------------------------------------------+
 * |   Y   |  Y   |  N  |     *     |    *    | (start <= DTSTART+DURATION) AND           |
 * |       |      |     |           |         | ((end > DTSTART) OR (end >= DTSTART+DUR)) |
 * +-------+------+-----+-----------+---------+-------------------------------------------+
 * |   Y   |  N   |  Y  |     *     |    *    | ((start < DUE) OR (start <= DTSTART)) AND |
 * |       |      |     |           |         | ((end > DTSTART) OR (end >= DUE))         |
 * +-------+------+-----+-----------+---------+-------------------------------------------+
 * |   Y   |  N   |  N  |     *     |    *    | (start <= DTSTART) AND (end > DTSTART)    |
 * +-------+------+-----+-----------+---------+-------------------------------------------+
 * |   N   |  N   |  Y  |     *     |    *    | (start < DUE) AND (end >= DUE)            |
 * +-------+------+-----+-----------+---------+-------------------------------------------+
 * |   N   |  N   |  N  |     Y     |    Y    | ((start <= CREATED) OR (start <=COMPLETED)|
 * |       |      |     |           |         | AND ((end >= CREATED) OR (end >=COMPLETED)|
 * +-------+------+-----+-----------+---------+-------------------------------------------+
 * |   N   |  N   |  N  |     Y     |    N    | (start <= COMPLETED) AND (end >= COMPLETED|
 * +-------+------+-----+-----------+---------+-------------------------------------------+
 * |   N   |  N   |  N  |     N     |    Y    | (end > CREATED)                           |
 * +-------+------+-----+-----------+---------+-------------------------------------------+
 * |   N   |  N   |  N  |     N     |    N    | TRUE                                      |
 * +-------+------+-----+-----------+---------+-------------------------------------------+
 */
const evalVtodoTimeRange = (
	comp: IrComponent,
	range: { start?: Temporal.Instant; end?: Temporal.Instant },
): boolean => {
	const { start, end } = range;
	const dtstart = getDtstartInstant(comp);
	const due = getDtendInstant(comp); // getDtendProp checks DUE for VTODO
	const hasDuration = comp.properties.some((p) => p.name === "DURATION");

	const completedProp = comp.properties.find((p) => p.name === "COMPLETED");
	const completed = completedProp
		? instantFromIrValue(completedProp)
		: undefined;

	const createdProp = comp.properties.find((p) => p.name === "CREATED");
	const created = createdProp ? instantFromIrValue(createdProp) : undefined;

	// RFC: rows with Y in DTSTART column — COMPLETED/CREATED columns are "*" (irrelevant).
	if (dtstart !== undefined && hasDuration && due === undefined) {
		// Y, Y, N: (start <= DTSTART+DURATION) AND ((end > DTSTART) OR (end >= DTSTART+DURATION))
		const effectiveDue = effectiveDtend(comp, dtstart);
		const startOk =
			start === undefined ||
			start.epochMilliseconds <= effectiveDue.epochMilliseconds;
		const endOk =
			end === undefined ||
			end.epochMilliseconds > dtstart.epochMilliseconds ||
			end.epochMilliseconds >= effectiveDue.epochMilliseconds;
		return startOk && endOk;
	}

	if (dtstart !== undefined && due !== undefined) {
		// Y, N, Y: ((start < DUE) OR (start <= DTSTART)) AND ((end > DTSTART) OR (end >= DUE))
		const startOk =
			start === undefined ||
			start.epochMilliseconds < due.epochMilliseconds ||
			start.epochMilliseconds <= dtstart.epochMilliseconds;
		const endOk =
			end === undefined ||
			end.epochMilliseconds > dtstart.epochMilliseconds ||
			end.epochMilliseconds >= due.epochMilliseconds;
		return startOk && endOk;
	}

	if (dtstart !== undefined) {
		// Y, N, N: (start <= DTSTART) AND (end > DTSTART)
		const startOk =
			start === undefined ||
			start.epochMilliseconds <= dtstart.epochMilliseconds;
		const endOk =
			end === undefined || end.epochMilliseconds > dtstart.epochMilliseconds;
		return startOk && endOk;
	}

	if (due !== undefined) {
		// N, N, Y: (start < DUE) AND (end >= DUE)
		const startOk =
			start === undefined || start.epochMilliseconds < due.epochMilliseconds;
		const endOk =
			end === undefined || end.epochMilliseconds >= due.epochMilliseconds;
		return startOk && endOk;
	}

	// N, N, N — dispatch on COMPLETED / CREATED presence.
	if (completed !== undefined && created !== undefined) {
		// ((start <= CREATED) OR (start <= COMPLETED)) AND ((end >= CREATED) OR (end >= COMPLETED))
		const startOk =
			start === undefined ||
			start.epochMilliseconds <= created.epochMilliseconds ||
			start.epochMilliseconds <= completed.epochMilliseconds;
		const endOk =
			end === undefined ||
			end.epochMilliseconds >= created.epochMilliseconds ||
			end.epochMilliseconds >= completed.epochMilliseconds;
		return startOk && endOk;
	}

	if (completed !== undefined) {
		// (start <= COMPLETED) AND (end >= COMPLETED)
		const startOk =
			start === undefined ||
			start.epochMilliseconds <= completed.epochMilliseconds;
		const endOk =
			end === undefined || end.epochMilliseconds >= completed.epochMilliseconds;
		return startOk && endOk;
	}

	if (created !== undefined) {
		// (end > CREATED)
		return (
			end === undefined || end.epochMilliseconds > created.epochMilliseconds
		);
	}

	// N, N, N, N, N → TRUE
	return true;
};

/**
 * VJOURNAL time-range matching — RFC 4791 §9.9 rule table.
 *
 * +-------+-----------+---------------------------------------------+
 * |DTSTART| DATE-TIME?| Condition                                   |
 * +-------+-----------+---------------------------------------------+
 * |   Y   |     Y     | (start <= DTSTART) AND (end > DTSTART)      |
 * |   Y   |     N     | (start < DTSTART+P1D) AND (end > DTSTART)   |
 * |   N   |     *     | FALSE                                       |
 * +-------+-----------+---------------------------------------------+
 */
const evalVjournalTimeRange = (
	comp: IrComponent,
	range: { start?: Temporal.Instant; end?: Temporal.Instant },
): boolean => {
	const dtstartProp = getDtstartProp(comp);
	if (!dtstartProp) {
		return false;
	}
	const dtstart = instantFromIrValue(dtstartProp);
	if (dtstart === undefined) {
		return false; // Floating — no timezone context
	}
	const { start, end } = range;

	const isDateTime =
		dtstartProp.value.type === "DATE_TIME" ||
		dtstartProp.value.type === "PLAIN_DATE_TIME";

	if (isDateTime) {
		// (start <= DTSTART) AND (end > DTSTART)
		const startOk =
			start === undefined ||
			start.epochMilliseconds <= dtstart.epochMilliseconds;
		const endOk =
			end === undefined || end.epochMilliseconds > dtstart.epochMilliseconds;
		return startOk && endOk;
	}

	// DATE value: effective duration is 1 day
	const dtendPlusOneDay = dtstart.add({ hours: 24 });
	const startOk =
		start === undefined ||
		start.epochMilliseconds < dtendPlusOneDay.epochMilliseconds;
	const endOk =
		end === undefined || end.epochMilliseconds > dtstart.epochMilliseconds;
	return startOk && endOk;
};

/**
 * VFREEBUSY time-range matching — RFC 4791 §9.9 rule table.
 *
 *   Y DTSTART + DTEND: (start <= DTEND) AND (end > DTSTART)
 *   N FREEBUSY only:   any period p: (start < p.end) AND (end > p.start)
 *   N neither:         FALSE
 *
 * Note: DURATION is explicitly ignored for VFREEBUSY per the RFC.
 */
const evalVfreebusyTimeRange = (
	comp: IrComponent,
	range: { start?: Temporal.Instant; end?: Temporal.Instant },
): boolean => {
	const dtstart = getDtstartInstant(comp);
	const dtend = getDtendInstant(comp);

	if (dtstart && dtend) {
		// Y | *: (range.start <= DTEND) AND (range.end > DTSTART)
		const startOk =
			!range.start || range.start.epochMilliseconds <= dtend.epochMilliseconds;
		const endOk =
			!range.end || range.end.epochMilliseconds > dtstart.epochMilliseconds;
		return startOk && endOk;
	}

	// N | Y: check each FREEBUSY period
	for (const prop of comp.properties) {
		if (prop.name !== "FREEBUSY") {
			continue;
		}
		const periodStrings: Array<string> =
			prop.value.type === "PERIOD"
				? [prop.value.value]
				: prop.value.type === "PERIOD_LIST"
					? (prop.value.value as ReadonlyArray<string>).slice()
					: [];
		for (const ps of periodStrings) {
			const slash = ps.indexOf("/");
			if (slash === -1) {
				continue;
			}
			try {
				const pStart = Temporal.Instant.from(ps.slice(0, slash));
				const endPart = ps.slice(slash + 1);
				const pEnd =
					endPart.startsWith("P") || endPart.startsWith("-P")
						? pStart.add(Temporal.Duration.from(endPart))
						: Temporal.Instant.from(endPart);
				const startOk =
					!range.start ||
					range.start.epochMilliseconds < pEnd.epochMilliseconds;
				const endOk =
					!range.end || range.end.epochMilliseconds > pStart.epochMilliseconds;
				if (startOk && endOk) {
					return true;
				}
			} catch {
				// Invalid period — skip
			}
		}
	}

	// N | N: FALSE; N | Y but no period matched: FALSE
	return false;
};

/**
 * Compute the alarm trigger instant(s) for a VALARM. RFC 4791 §9.10: a relative
 * DURATION trigger is anchored to the parent component's DTSTART (default) or
 * its DTEND/effective end (RELATED=END); an absolute trigger is a DATE-TIME.
 * DURATION+REPEAT defines a repeating alarm, so multiple triggers.
 */
const valarmTriggerInstants = (
	alarm: IrComponent,
	parent: IrComponent | undefined,
): ReadonlyArray<Temporal.Instant> => {
	const trigger = alarm.properties.find((p) => p.name === "TRIGGER");
	if (!trigger) {
		return [];
	}
	if (trigger.value.type === "DATE_TIME") {
		const abs = instantFromIrValue(trigger);
		return abs ? [abs] : [];
	}
	if (trigger.value.type !== "DURATION" || parent === undefined) {
		return [];
	}
	const dtstart = getDtstartInstant(parent);
	if (dtstart === undefined) {
		return [];
	}
	const relatedEnd =
		trigger.parameters
			.find((p) => p.name.toUpperCase() === "RELATED")
			?.value.toUpperCase() === "END";
	const anchor = relatedEnd ? effectiveDtend(parent, dtstart) : dtstart;
	const addDuration = (
		base: Temporal.Instant,
		iso: string,
	): Temporal.Instant | undefined => {
		try {
			return base
				.toZonedDateTimeISO("UTC")
				.add(Temporal.Duration.from(iso))
				.toInstant();
		} catch {
			return undefined;
		}
	};
	const first = addDuration(anchor, trigger.value.value);
	if (first === undefined) {
		return [];
	}
	const triggers: Array<Temporal.Instant> = [first];
	// RFC 5545 §3.8.6.{2,3}: DURATION (the repeat interval) + REPEAT (count).
	const repeatProp = alarm.properties.find((p) => p.name === "REPEAT");
	const intervalProp = alarm.properties.find((p) => p.name === "DURATION");
	const repeat =
		repeatProp?.value.type === "INTEGER" ? repeatProp.value.value : 0;
	if (repeat > 0 && intervalProp?.value.type === "DURATION") {
		let prev = first;
		for (let i = 0; i < repeat; i++) {
			const next = addDuration(prev, intervalProp.value.value);
			if (next === undefined) {
				break;
			}
			triggers.push(next);
			prev = next;
		}
	}
	return triggers;
};

const evalComponentTimeRange = (
	comp: IrComponent,
	range: { start?: Temporal.Instant; end?: Temporal.Instant },
	vcalRoot: IrComponent,
	limits: RruleExpansionLimits,
	parent?: IrComponent,
): boolean => {
	// RFC 4791 §9.10: VALARM matches if a computed trigger falls in the range.
	if (comp.name === "VALARM") {
		return valarmTriggerInstants(comp, parent).some((t) => {
			if (range.start && t.epochMilliseconds < range.start.epochMilliseconds) {
				return false;
			}
			if (range.end && t.epochMilliseconds >= range.end.epochMilliseconds) {
				return false;
			}
			return true;
		});
	}

	const rruleProp = comp.properties.find((p) => p.name === "RRULE");
	if (rruleProp) {
		return hasOccurrenceInRange(
			vcalRoot,
			comp,
			range.start ?? OPEN_RANGE_START,
			range.end ?? OPEN_RANGE_END,
			limits,
		);
	}

	if (comp.name === "VTODO") {
		return evalVtodoTimeRange(comp, range);
	}

	if (comp.name === "VFREEBUSY") {
		return evalVfreebusyTimeRange(comp, range);
	}

	if (comp.name === "VJOURNAL") {
		return evalVjournalTimeRange(comp, range);
	}

	// VEVENT: DTSTART < end AND effective_DTEND > start.
	const dtstart = getDtstartInstant(comp);
	if (!dtstart) {
		return true; // No DTSTART → pass conservatively
	}

	const dtend = effectiveDtend(comp, dtstart); // RFC 4791 §9.9: DTEND, or DTSTART + DURATION, or DTSTART

	const startMs = dtstart.epochMilliseconds;
	const endMs = dtend.epochMilliseconds;

	if (range.start && endMs <= range.start.epochMilliseconds) {
		return false;
	}
	if (range.end && startMs >= range.end.epochMilliseconds) {
		return false;
	}
	return true;
};

const propValueText = (prop: IrProperty): string => {
	const v = prop.value;
	if (v.type === "TEXT") {
		return v.value;
	}
	if (v.type === "DATE") {
		return v.value.toString();
	}
	if (v.type === "DATE_TIME") {
		return v.value.toString();
	}
	if (v.type === "INTEGER" || v.type === "FLOAT") {
		return String(v.value);
	}
	if (v.type === "BOOLEAN") {
		return String(v.value);
	}
	// Multi-valued properties (CATEGORIES, RESOURCES, EXDATE, …). A text-match
	// must see every value, not just the first / an empty string — otherwise a
	// search like `category=PERSONAL` against `CATEGORIES:ANNIVERSARY,PERSONAL`
	// never matches. Render the comma-joined iCalendar form so `contains`
	// matches any member.
	if (v.type === "TEXT_LIST") {
		return v.value.join(",");
	}
	if (v.type === "DATE_LIST" || v.type === "DATE_TIME_LIST") {
		return v.value.map((item) => item.toString()).join(",");
	}
	if ("value" in v && typeof v.value === "string") {
		return v.value;
	}
	return "";
};
