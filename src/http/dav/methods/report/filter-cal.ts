// ---------------------------------------------------------------------------
// iCalendar filter parsing and evaluation — RFC 4791 §9.7–9.9
//
// Parses <CALDAV:filter> elements and evaluates them against an IrDocument.
//
// RRULE / Recurrence limitation:
//   Events with rrule_text always pass time-range filters (conservative
//   behavior). Full recurrence expansion is deferred.
//   TODO(recurrence): expand rrule_text for accurate overlap when recurrence
//   expansion is implemented.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import type { IrComponent, IrDocument, IrProperty } from "#src/data/ir.ts";
import type { DavError } from "#src/domain/errors.ts";
import { forbidden } from "#src/domain/errors.ts";

const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
const cn = (local: string): string => `{${CALDAV_NS}}${local}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TextMatch {
	readonly value: string;
	readonly collation: "i;ascii-casemap" | "i;unicode-casemap";
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
	if (typeof el !== "object" || el === null) {
		return undefined;
	}
	const obj = el as Record<string, unknown>;
	const value =
		typeof obj["#text"] === "string"
			? obj["#text"]
			: typeof obj === "string"
				? obj
				: "";
	const collation =
		obj["@_collation"] === "i;unicode-casemap"
			? "i;unicode-casemap"
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

const parseTimeRange = (
	el: unknown,
): { start?: Temporal.Instant; end?: Temporal.Instant } | undefined => {
	if (typeof el !== "object" || el === null) {
		return undefined;
	}
	const obj = el as Record<string, unknown>;
	const start =
		typeof obj["@_start"] === "string"
			? Temporal.Instant.from(obj["@_start"])
			: undefined;
	const end =
		typeof obj["@_end"] === "string"
			? Temporal.Instant.from(obj["@_end"])
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
): boolean => evalCompFilter(doc.root, filter.compFilter);

const evalCompFilter = (comp: IrComponent, f: CompFilter): boolean => {
	if (f.name !== comp.name) {
		// comp-filter applies to a different component name — look in children
		return comp.components.some((child) => evalCompFilter(child, f));
	}

	if (f.isNotDefined) {
		// is-not-defined: the component should NOT be present — since we're here, it is present, so this fails
		return false;
	}

	// Time-range filter on the component
	if (f.timeRange && !evalComponentTimeRange(comp, f.timeRange)) {
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
		} else if (!matchingChildren.some((c) => evalCompFilter(c, cf))) {
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

	for (const prop of props) {
		if (f.textMatch && !evalTextMatch(propValueText(prop), f.textMatch)) {
			return false;
		}
		for (const pf of f.paramFilters) {
			if (!evalParamFilter(prop, pf)) {
				return false;
			}
		}
	}
	return true;
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
	const fold = (s: string) =>
		tm.collation === "i;unicode-casemap"
			? s.normalize("NFC").toLowerCase()
			: s.toLowerCase();
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
 * Evaluate a time-range filter on a component.
 *
 * RRULE components always pass (conservative recurrence handling).
 * TODO(recurrence): expand rrule_text for accurate overlap when recurrence
 * expansion is implemented.
 */
const evalComponentTimeRange = (
	comp: IrComponent,
	range: { start?: Temporal.Instant; end?: Temporal.Instant },
): boolean => {
	// Conservative: always pass if the component has an RRULE
	const hasRrule = comp.properties.some((p) => p.name === "RRULE");
	if (hasRrule) {
		return true;
	}

	const dtstart = getDtstart(comp);
	if (!dtstart) {
		return true; // No DTSTART → pass conservatively
	}

	const dtend = getDtend(comp) ?? dtstart; // Use DTSTART as DTEND if absent (zero-duration)

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

const getDtstart = (comp: IrComponent): Temporal.Instant | undefined => {
	const prop = comp.properties.find((p) => p.name === "DTSTART");
	if (!prop) {
		return undefined;
	}
	return instantFromIrValue(prop);
};

const getDtend = (comp: IrComponent): Temporal.Instant | undefined => {
	const prop =
		comp.properties.find((p) => p.name === "DTEND") ??
		comp.properties.find((p) => p.name === "DUE");
	if (!prop) {
		return undefined;
	}
	return instantFromIrValue(prop);
};

const instantFromIrValue = (prop: IrProperty): Temporal.Instant | undefined => {
	const v = prop.value;
	if (v.type === "DATE_TIME") {
		return v.value.toInstant();
	}
	if (v.type === "DATE") {
		// Treat all-day events as starting at UTC midnight
		return Temporal.Instant.from(`${v.value.toString()}T00:00:00Z`);
	}
	return undefined; // PLAIN_DATE_TIME (floating) — no timezone context
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
	if ("value" in v && typeof v.value === "string") {
		return v.value;
	}
	return "";
};

export type { Temporal } from "temporal-polyfill";
