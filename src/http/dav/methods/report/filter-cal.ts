// ---------------------------------------------------------------------------
// iCalendar filter parsing and evaluation — RFC 4791 §9.7–9.9
//
// Parses <CALDAV:filter> elements and evaluates them against an IrDocument.
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
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
import type { ResolutionZone } from "#src/data/icalendar/resolve-floating.ts";
import type { IrComponent, IrDocument, IrProperty } from "#src/data/ir.ts";
import type { DavError } from "#src/domain/errors.ts";
import { forbidden } from "#src/domain/errors.ts";

const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
const cn = (local: string): string => `{${CALDAV_NS}}${local}`;

/** True when an unknown value is a plain (non-null) object */
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

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

/** A `<CALDAV:time-range>`; a missing bound is open-ended. */
export interface TimeRange {
	readonly start?: Temporal.Instant;
	readonly end?: Temporal.Instant;
}

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
	readonly timeRange?: TimeRange;
	readonly textMatch?: TextMatch;
	readonly paramFilters: ReadonlyArray<ParamFilter>;
}

export interface CompFilter {
	readonly name: string;
	readonly isNotDefined?: boolean;
	readonly timeRange?: TimeRange;
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
	if (!isRecord(tree)) {
		return Effect.fail(forbidden("CALDAV:valid-filter"));
	}
	const filterEl = tree[cn("filter")];
	if (!isRecord(filterEl)) {
		return Effect.fail(forbidden("CALDAV:valid-filter"));
	}
	const compEl = filterEl[cn("comp-filter")];
	if (!compEl) {
		return Effect.fail(forbidden("CALDAV:valid-filter"));
	}
	return Effect.succeed({ compFilter: parseCompFilter(compEl) });
};

const parseCompFilter = (el: unknown): CompFilter => {
	if (!isRecord(el)) {
		return { name: "", isNotDefined: false, propFilters: [], compFilters: [] };
	}
	const name = typeof el["@_name"] === "string" ? el["@_name"] : "";
	const isNotDefined = cn("is-not-defined") in el;
	const timeRange = parseTimeRange(el[cn("time-range")]);

	const propFilters = parseChildren(el[cn("prop-filter")], parsePropFilter);
	const compFilters = parseChildren(el[cn("comp-filter")], parseCompFilter);

	return { name, isNotDefined, timeRange, propFilters, compFilters };
};

const parsePropFilter = (el: unknown): PropFilter => {
	if (!isRecord(el)) {
		return { name: "", paramFilters: [] };
	}
	const name = typeof el["@_name"] === "string" ? el["@_name"] : "";
	const isNotDefined = cn("is-not-defined") in el;
	const timeRange = parseTimeRange(el[cn("time-range")]);
	const textMatch = parseTextMatch(el[cn("text-match")]);
	const paramFilters = parseChildren(el[cn("param-filter")], parseParamFilter);
	return { name, isNotDefined, timeRange, textMatch, paramFilters };
};

const parseParamFilter = (el: unknown): ParamFilter => {
	if (!isRecord(el)) {
		return { name: "" };
	}
	const name = typeof el["@_name"] === "string" ? el["@_name"] : "";
	const isNotDefined = cn("is-not-defined") in el;
	const textMatch = parseTextMatch(el[cn("text-match")]);
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
	if (!isRecord(el)) {
		return undefined;
	}
	const rawText = el["#text"];
	const value =
		typeof rawText === "string"
			? rawText
			: typeof rawText === "number"
				? String(rawText)
				: "";
	return {
		value,
		collation: parseCollation(el["@_collation"]),
		matchType: parseMatchType(el["@_match-type"]),
		negate: el["@_negate-condition"] === "yes",
	};
};

/** Read a `collation` attribute, defaulting to the RFC 4791 default collation */
const parseCollation = (raw: unknown): TextMatch["collation"] =>
	raw === "i;unicode-casemap" || raw === "i;octet" ? raw : "i;ascii-casemap";

/** Read a `match-type` attribute, defaulting to `contains` */
const parseMatchType = (raw: unknown): TextMatch["matchType"] =>
	raw === "equals" || raw === "starts-with" || raw === "ends-with"
		? raw
		: "contains";

/** Parse an ISO instant, yielding none for an unparseable value */
const parseInstant = Option.liftThrowable((s: string) =>
	Temporal.Instant.from(s),
);

/** Read one `start`/`end` attribute of a `<time-range>` element */
const rangeBound = (raw: unknown): Temporal.Instant | undefined =>
	typeof raw === "string"
		? Option.getOrUndefined(parseInstant(raw))
		: undefined;

const parseTimeRange = (el: unknown): TimeRange | undefined => {
	if (!isRecord(el)) {
		return undefined;
	}
	const start = rangeBound(el["@_start"]);
	const end = rangeBound(el["@_end"]);
	if (!(start || end)) {
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

// Range-bound comparisons. A missing bound is open-ended, so every predicate is
// vacuously true when its bound is absent.

/** `range.start <= t` */
const startAtOrBefore = (range: TimeRange, t: Temporal.Instant): boolean =>
	range.start === undefined ||
	range.start.epochMilliseconds <= t.epochMilliseconds;

/** `range.start < t` */
const startBefore = (range: TimeRange, t: Temporal.Instant): boolean =>
	range.start === undefined ||
	range.start.epochMilliseconds < t.epochMilliseconds;

/** `range.end > t` */
const endAfter = (range: TimeRange, t: Temporal.Instant): boolean =>
	range.end === undefined || range.end.epochMilliseconds > t.epochMilliseconds;

/** `range.end >= t` */
const endAtOrAfter = (range: TimeRange, t: Temporal.Instant): boolean =>
	range.end === undefined || range.end.epochMilliseconds >= t.epochMilliseconds;

/** True when an instant falls in the range: start inclusive, end exclusive */
const instantInRange = (t: Temporal.Instant, range: TimeRange): boolean =>
	startAtOrBefore(range, t) && endAfter(range, t);

/**
 * @param zone Zone that floating and DATE values are read in, per RFC 4791
 *             section 7.3. Resolved by the caller from the request's
 *             CALDAV:timezone or the collection's CALDAV:calendar-timezone.
 */
export const evaluateCalFilter = (
	doc: IrDocument,
	filter: CalFilter,
	zone: ResolutionZone,
	limits: RruleExpansionLimits = DEFAULT_RRULE_LIMITS,
): boolean =>
	evalCompFilter(doc.root, filter.compFilter, {
		vcalRoot: doc.root,
		zone,
		limits,
	});

/** What matching a comp-filter needs besides the component and the filter. */
interface CompFilterContext {
	readonly vcalRoot: IrComponent;
	readonly zone: ResolutionZone;
	readonly limits: RruleExpansionLimits;
	// The component enclosing the one being matched, when there is one. Needed to
	// evaluate a VALARM time-range, whose TRIGGER is relative to its parent.
	readonly parent?: IrComponent;
}

const evalCompFilter = (
	comp: IrComponent,
	f: CompFilter,
	ctx: CompFilterContext,
): boolean => {
	if (f.name !== comp.name) {
		// comp-filter applies to a different component name — look in children
		return comp.components.some((child) =>
			evalCompFilter(child, f, { ...ctx, parent: comp }),
		);
	}

	if (f.isNotDefined) {
		// is-not-defined: the component should NOT be present — since we're here, it is present, so this fails
		return false;
	}

	// Time-range filter on the component
	if (f.timeRange && !evalComponentTimeRange(comp, f.timeRange, ctx)) {
		return false;
	}

	// Prop filters
	for (const pf of f.propFilters) {
		if (!evalPropFilter(comp, pf, ctx.zone)) {
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
				evalCompFilter(c, cf, { ...ctx, parent: comp }),
			)
		) {
			return false;
		}
	}

	return true;
};

const evalPropFilter = (
	comp: IrComponent,
	f: PropFilter,
	zone: ResolutionZone,
): boolean => {
	const props = comp.properties.filter((p) => p.name === f.name);

	if (f.isNotDefined) {
		return props.length === 0;
	}
	if (props.length === 0) {
		return false;
	}

	return props.some((prop) => propMatchesFilter(prop, f, zone));
};

/** True when a property's resolved date value falls inside a prop-filter time-range */
const propInTimeRange = (
	prop: IrProperty,
	range: TimeRange,
	zone: ResolutionZone,
): boolean => {
	const instant = instantFromIrValue(prop, zone);
	// floating time, no timezone → no match
	return instant !== undefined && instantInRange(instant, range);
};

/** True when one property satisfies a prop-filter's time-range, text-match and param-filters */
const propMatchesFilter = (
	prop: IrProperty,
	f: PropFilter,
	zone: ResolutionZone,
): boolean => {
	if (f.timeRange && !propInTimeRange(prop, f.timeRange, zone)) {
		return false;
	}
	if (f.textMatch && !evalTextMatch(propValueText(prop), f.textMatch)) {
		return false;
	}
	return f.paramFilters.every((pf) => evalParamFilter(prop, pf));
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

// RFC 4791 §7.5.1: i;ascii-casemap and i;octet are mandatory. The casemap
// collations fold case; i;octet is an exact byte/codepoint comparison
// (case-sensitive), which clients rely on for e.g. an exact CATEGORIES match.
const COLLATION_FOLD: Readonly<
	Record<TextMatch["collation"], (s: string) => string>
> = {
	"i;octet": (s) => s,
	"i;unicode-casemap": (s) => s.normalize("NFC").toLowerCase(),
	"i;ascii-casemap": (s) => s.toLowerCase(),
};

/** Comparison performed by each RFC 4791 text-match `match-type` */
const MATCH_TYPE_TEST: Readonly<
	Record<TextMatch["matchType"], (haystack: string, needle: string) => boolean>
> = {
	equals: (haystack, needle) => haystack === needle,
	contains: (haystack, needle) => haystack.includes(needle),
	"starts-with": (haystack, needle) => haystack.startsWith(needle),
	"ends-with": (haystack, needle) => haystack.endsWith(needle),
};

const evalTextMatch = (text: string, tm: TextMatch): boolean => {
	const fold = COLLATION_FOLD[tm.collation];
	const matches = MATCH_TYPE_TEST[tm.matchType](fold(text), fold(tm.value));
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
	range: TimeRange,
	zone: ResolutionZone,
): boolean => {
	const dtstart = getDtstartInstant(comp, zone);
	const due = getDtendInstant(comp, zone); // getDtendProp checks DUE for VTODO
	const hasDuration = comp.properties.some((p) => p.name === "DURATION");

	// RFC: rows with Y in DTSTART column — COMPLETED/CREATED columns are "*" (irrelevant).
	if (dtstart !== undefined && hasDuration && due === undefined) {
		// Y, Y, N: (start <= DTSTART+DURATION) AND ((end > DTSTART) OR (end >= DTSTART+DURATION))
		const effectiveDue = effectiveDtend(comp, dtstart, zone);
		return (
			startAtOrBefore(range, effectiveDue) &&
			(endAfter(range, dtstart) || endAtOrAfter(range, effectiveDue))
		);
	}

	if (dtstart !== undefined && due !== undefined) {
		// Y, N, Y: ((start < DUE) OR (start <= DTSTART)) AND ((end > DTSTART) OR (end >= DUE))
		return (
			(startBefore(range, due) || startAtOrBefore(range, dtstart)) &&
			(endAfter(range, dtstart) || endAtOrAfter(range, due))
		);
	}

	if (dtstart !== undefined) {
		// Y, N, N: (start <= DTSTART) AND (end > DTSTART)
		return instantInRange(dtstart, range);
	}

	if (due !== undefined) {
		// N, N, Y: (start < DUE) AND (end >= DUE)
		return startBefore(range, due) && endAtOrAfter(range, due);
	}

	// N, N, N — dispatch on COMPLETED / CREATED presence.
	return evalVtodoStamps(comp, range, zone);
};

/**
 * RFC 4791 §9.9 VTODO rows with neither DTSTART nor DUE: dispatch on the
 * COMPLETED / CREATED timestamps, and match everything when neither is present.
 */
const evalVtodoStamps = (
	comp: IrComponent,
	range: TimeRange,
	zone: ResolutionZone,
): boolean => {
	const completed = propInstant(comp, "COMPLETED", zone);
	const created = propInstant(comp, "CREATED", zone);

	if (completed !== undefined && created !== undefined) {
		// ((start <= CREATED) OR (start <= COMPLETED)) AND ((end >= CREATED) OR (end >= COMPLETED))
		return (
			(startAtOrBefore(range, created) || startAtOrBefore(range, completed)) &&
			(endAtOrAfter(range, created) || endAtOrAfter(range, completed))
		);
	}

	if (completed !== undefined) {
		// (start <= COMPLETED) AND (end >= COMPLETED)
		return startAtOrBefore(range, completed) && endAtOrAfter(range, completed);
	}

	if (created !== undefined) {
		// (end > CREATED)
		return endAfter(range, created);
	}

	// N, N, N, N, N → TRUE
	return true;
};

/** Resolve a named property of a component to an instant, if it has one */
const propInstant = (
	comp: IrComponent,
	name: string,
	zone: ResolutionZone,
): Temporal.Instant | undefined => {
	const prop = comp.properties.find((p) => p.name === name);
	return prop ? instantFromIrValue(prop, zone) : undefined;
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
	range: TimeRange,
	zone: ResolutionZone,
): boolean => {
	const dtstartProp = getDtstartProp(comp);
	if (!dtstartProp) {
		return false;
	}
	const dtstart = instantFromIrValue(dtstartProp, zone);
	if (dtstart === undefined) {
		return false; // DTSTART is not a date value
	}
	const isDateTime =
		dtstartProp.value.type === "DATE_TIME" ||
		dtstartProp.value.type === "PLAIN_DATE_TIME";

	if (isDateTime) {
		// (start <= DTSTART) AND (end > DTSTART)
		return instantInRange(dtstart, range);
	}

	// DATE value: effective duration is 1 day, counted on the resolution zone's
	// calendar so a day carrying a DST change is still one day rather than 24h
	const dtendPlusOneDay = dtstart
		.toZonedDateTimeISO(zone)
		.add({ days: 1 })
		.toInstant();
	// (start < DTSTART+P1D) AND (end > DTSTART)
	return startBefore(range, dtendPlusOneDay) && endAfter(range, dtstart);
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
	range: TimeRange,
	zone: ResolutionZone,
): boolean => {
	const dtstart = getDtstartInstant(comp, zone);
	const dtend = getDtendInstant(comp, zone);

	if (dtstart && dtend) {
		// Y | *: (range.start <= DTEND) AND (range.end > DTSTART)
		return startAtOrBefore(range, dtend) && endAfter(range, dtstart);
	}

	// N | Y: any FREEBUSY period overlapping the range matches; N | N: FALSE
	return comp.properties
		.filter((prop) => prop.name === "FREEBUSY")
		.flatMap(freebusyPeriods)
		.flatMap((period) => Option.toArray(parsePeriod(period)))
		.some((p) => startBefore(range, p.end) && endAfter(range, p.start));
};

/** The raw PERIOD value(s) carried by a FREEBUSY property */
const freebusyPeriods = (prop: IrProperty): ReadonlyArray<string> =>
	prop.value.type === "PERIOD"
		? [prop.value.value]
		: prop.value.type === "PERIOD_LIST"
			? (prop.value.value as ReadonlyArray<string>)
			: [];

/** Resolve a period's halves, where the second may be an ISO duration */
const periodBounds = Option.liftThrowable(
	(startText: string, endText: string) => {
		const start = Temporal.Instant.from(startText);
		const end =
			endText.startsWith("P") || endText.startsWith("-P")
				? start.add(Temporal.Duration.from(endText))
				: Temporal.Instant.from(endText);
		return { start, end };
	},
);

/** Parse an iCalendar period ("<start>/<end>" or "<start>/<duration>") */
const parsePeriod = (
	period: string,
): Option.Option<{ start: Temporal.Instant; end: Temporal.Instant }> => {
	const slash = period.indexOf("/");
	return slash === -1
		? Option.none()
		: periodBounds(period.slice(0, slash), period.slice(slash + 1));
};

/**
 * Shift an instant by an ISO duration. Nominal units are counted on the
 * resolution zone's calendar, so a "one day before" alarm stays at the same wall
 * time across a DST change. Yields none for an unparseable duration.
 */
const shiftByDuration = Option.liftThrowable(
	(base: Temporal.Instant, iso: string, zone: ResolutionZone) =>
		base.toZonedDateTimeISO(zone).add(Temporal.Duration.from(iso)).toInstant(),
);

/**
 * Compute the alarm trigger instant(s) for a VALARM. RFC 4791 §9.10: a relative
 * DURATION trigger is anchored to the parent component's DTSTART (default) or
 * its DTEND/effective end (RELATED=END); an absolute trigger is a DATE-TIME.
 * DURATION+REPEAT defines a repeating alarm, so multiple triggers.
 */
const valarmTriggerInstants = (
	alarm: IrComponent,
	parent: IrComponent | undefined,
	zone: ResolutionZone,
): ReadonlyArray<Temporal.Instant> => {
	const trigger = alarm.properties.find((p) => p.name === "TRIGGER");
	if (!trigger) {
		return [];
	}
	if (trigger.value.type === "DATE_TIME") {
		const abs = instantFromIrValue(trigger, zone);
		return abs ? [abs] : [];
	}
	if (trigger.value.type !== "DURATION" || parent === undefined) {
		return [];
	}
	const dtstart = getDtstartInstant(parent, zone);
	if (dtstart === undefined) {
		return [];
	}
	const relatedEnd =
		trigger.parameters
			.find((p) => p.name.toUpperCase() === "RELATED")
			?.value.toUpperCase() === "END";
	const anchor = relatedEnd ? effectiveDtend(parent, dtstart, zone) : dtstart;
	const addDuration = (
		base: Temporal.Instant,
		iso: string,
	): Temporal.Instant | undefined =>
		Option.getOrUndefined(shiftByDuration(base, iso, zone));
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
	range: TimeRange,
	ctx: CompFilterContext,
): boolean => {
	const { vcalRoot, zone, limits, parent } = ctx;
	// RFC 4791 §9.10: VALARM matches if a computed trigger falls in the range.
	if (comp.name === "VALARM") {
		return valarmTriggerInstants(comp, parent, zone).some((t) =>
			instantInRange(t, range),
		);
	}

	const rruleProp = comp.properties.find((p) => p.name === "RRULE");
	if (rruleProp) {
		return hasOccurrenceInRange(vcalRoot, comp, {
			queryStart: range.start ?? OPEN_RANGE_START,
			queryEnd: range.end ?? OPEN_RANGE_END,
			zone,
			limits,
		});
	}

	if (comp.name === "VTODO") {
		return evalVtodoTimeRange(comp, range, zone);
	}

	if (comp.name === "VFREEBUSY") {
		return evalVfreebusyTimeRange(comp, range, zone);
	}

	if (comp.name === "VJOURNAL") {
		return evalVjournalTimeRange(comp, range, zone);
	}

	// VEVENT: DTSTART < end AND effective_DTEND > start.
	const dtstart = getDtstartInstant(comp, zone);
	if (!dtstart) {
		return true; // No DTSTART → pass conservatively
	}

	const dtend = effectiveDtend(comp, dtstart, zone); // RFC 4791 §9.9: DTEND, or DTSTART + DURATION, or DTSTART

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
