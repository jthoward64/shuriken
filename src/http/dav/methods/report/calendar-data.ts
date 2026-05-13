// ---------------------------------------------------------------------------
// calendar-data subsetting — RFC 4791 §8.6
//
// Parses <C:calendar-data> elements from REPORT request bodies and applies
// the described component/property filters to an IrDocument before serialization.
// ---------------------------------------------------------------------------

import { Temporal } from "temporal-polyfill";
import type { IrComponent, IrDocument, IrProperty } from "#src/data/ir.ts";
import { getOccurrenceInstantsInRange } from "#src/data/icalendar/recurrence/recurrence-check.ts";

const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
const cn = (local: string): string => `{${CALDAV_NS}}${local}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExpandSpec {
	readonly start: Temporal.Instant;
	readonly end: Temporal.Instant;
}

export interface CalendarDataSpec {
	/** If true, return the full IrDocument without subsetting. */
	readonly allProps: boolean;
	readonly compSpec?: CompSpec;
	/**
	 * RFC 4791 §9.6.5 — when present, server expands recurring components to
	 * one calendar component per occurrence falling within [start, end), with
	 * RRULE/EXDATE/RDATE/VTIMEZONE stripped and times normalised to UTC.
	 */
	readonly expand?: ExpandSpec;
}

export interface CompSpec {
	readonly name: string;
	/** If true (no explicit <C:prop> children), include all properties. */
	readonly allProps: boolean;
	/** Explicit property names to include (when allProps = false). */
	readonly props: ReadonlySet<string>;
	/** Sub-component specs. If empty, include all sub-components unchanged. */
	readonly comps: ReadonlyArray<CompSpec>;
}

// ---------------------------------------------------------------------------
// parseCalendarDataSpec
// ---------------------------------------------------------------------------

/**
 * Parse the contents of a Clark-normalized `<C:calendar-data>` element.
 * Returns `{ allProps: true }` when the element is absent or has no comp child.
 */
export const parseCalendarDataSpec = (tree: unknown): CalendarDataSpec => {
	if (typeof tree !== "object" || tree === null) {
		return { allProps: true };
	}
	const obj = tree as Record<string, unknown>;
	const expand = parseExpandSpec(obj[cn("expand")]);
	const compEl = obj[cn("comp")];
	if (!compEl) {
		return expand ? { allProps: true, expand } : { allProps: true };
	}
	return expand
		? { allProps: false, compSpec: parseCompSpec(compEl), expand }
		: { allProps: false, compSpec: parseCompSpec(compEl) };
};

const parseExpandSpec = (el: unknown): ExpandSpec | undefined => {
	if (typeof el !== "object" || el === null) {
		return undefined;
	}
	const obj = el as Record<string, unknown>;
	const startRaw = obj["@_start"];
	const endRaw = obj["@_end"];
	if (typeof startRaw !== "string" || typeof endRaw !== "string") {
		return undefined;
	}
	const start = parseICalDatetime(startRaw);
	const end = parseICalDatetime(endRaw);
	if (start === undefined || end === undefined) {
		return undefined;
	}
	return { start, end };
};

/**
 * Parse an iCalendar basic-format UTC datetime (`YYYYMMDDTHHMMSSZ`) into a
 * Temporal.Instant. Returns undefined on malformed input; callers treat that
 * as "no expand range supplied" rather than failing the whole REPORT.
 */
const parseICalDatetime = (s: string): Temporal.Instant | undefined => {
	const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s);
	if (!m) {
		return undefined;
	}
	const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
	try {
		return Temporal.Instant.from(iso);
	} catch {
		return undefined;
	}
};

const parseCompSpec = (el: unknown): CompSpec => {
	if (typeof el !== "object" || el === null) {
		return { name: "", allProps: true, props: new Set(), comps: [] };
	}
	const obj = el as Record<string, unknown>;
	const name = typeof obj["@_name"] === "string" ? obj["@_name"] : "";

	// Collect explicit props
	const propEls = obj[cn("prop")];
	const props = new Set<string>();
	if (propEls) {
		const arr = Array.isArray(propEls) ? propEls : [propEls];
		for (const p of arr) {
			if (
				typeof p === "object" &&
				p !== null &&
				typeof (p as Record<string, unknown>)["@_name"] === "string"
			) {
				props.add((p as Record<string, unknown>)["@_name"] as string);
			}
		}
	}

	// Collect nested comp specs
	const compEls = obj[cn("comp")];
	const comps: Array<CompSpec> = [];
	if (compEls) {
		const arr = Array.isArray(compEls) ? compEls : [compEls];
		for (const c of arr) {
			comps.push(parseCompSpec(c));
		}
	}

	return {
		name,
		allProps: props.size === 0 && comps.length === 0,
		props,
		comps,
	};
};

// ---------------------------------------------------------------------------
// subsetIrDocument
// ---------------------------------------------------------------------------

/**
 * Apply a CalendarDataSpec to an IrDocument, returning a new IrDocument
 * with only the requested components and properties.
 *
 * VCALENDAR/VERSION and all VTIMEZONE components are always preserved so
 * clients can interpret TZID references in the returned data.
 */
export const subsetIrDocument = (
	doc: IrDocument,
	spec: CalendarDataSpec,
): IrDocument => {
	const subset =
		spec.allProps || !spec.compSpec
			? doc
			: { ...doc, root: subsetComponent(doc.root, spec.compSpec) };
	if (spec.expand && subset.kind === "icalendar") {
		return { ...subset, root: expandRecurrences(subset.root, spec.expand) };
	}
	return subset;
};

// ---------------------------------------------------------------------------
// expandRecurrences — RFC 4791 §9.6.5
// ---------------------------------------------------------------------------

const EXPAND_SCHEDULING_COMPONENTS = new Set([
	"VEVENT",
	"VTODO",
	"VJOURNAL",
	"VFREEBUSY",
]);
const EXPAND_DROPPED_PROPS = new Set([
	"RRULE",
	"RDATE",
	"EXDATE",
	"DTSTART",
	"DTEND",
	"DUE",
	"RECURRENCE-ID",
]);

/**
 * Expand recurring scheduling components in a VCALENDAR to one component per
 * occurrence intersecting `[expand.start, expand.end)`. Implements the rules
 * in RFC 4791 §9.6.5: output contains only scheduling components, never any
 * VTIMEZONE, and DTSTART/DTEND/RECURRENCE-ID are emitted in UTC.
 */
const expandRecurrences = (
	vcalRoot: IrComponent,
	expand: ExpandSpec,
): IrComponent => {
	const expanded: Array<IrComponent> = [];
	for (const sub of vcalRoot.components) {
		// RFC 4791 §9.6.5 ¶3.2: VTIMEZONE is dropped entirely from expanded output.
		if (sub.name === "VTIMEZONE") {
			continue;
		}
		if (!EXPAND_SCHEDULING_COMPONENTS.has(sub.name)) {
			expanded.push(sub);
			continue;
		}
		// Overrides (sibling components carrying RECURRENCE-ID) are already a
		// single-occurrence representation per RFC 5545 §3.8.4.4 — emit them
		// directly when they intersect the range. Their non-override siblings
		// (the recurrence master) handle the expansion below.
		const hasRecurrenceId = sub.properties.some(
			(p) => p.name === "RECURRENCE-ID",
		);
		const hasRrule = sub.properties.some((p) => p.name === "RRULE");
		if (hasRecurrenceId) {
			if (occurrenceIntersectsRange(sub, expand)) {
				expanded.push(rewriteToUtc(sub));
			}
			continue;
		}
		if (!hasRrule) {
			// One-shot component without recurrence: include verbatim if it
			// intersects the range. Comparing against DTSTART only is sufficient
			// because callers compose expand with a time-range filter.
			if (occurrenceIntersectsRange(sub, expand)) {
				expanded.push(rewriteToUtc(sub));
			}
			continue;
		}
		// Recurrence master — emit one component per occurrence in range.
		const instants = getOccurrenceInstantsInRange(
			vcalRoot,
			sub,
			expand.start,
			expand.end,
		);
		const duration = componentDuration(sub);
		for (const occurrenceStart of instants) {
			expanded.push(buildExpandedInstance(sub, occurrenceStart, duration));
		}
	}
	return { ...vcalRoot, components: expanded };
};

/**
 * Approximate occurrence-in-range test for the simple cases above (overrides
 * and non-recurring scheduling components). Uses DTSTART instant only; for
 * range-overlap we compose with the surrounding time-range filter.
 */
const occurrenceIntersectsRange = (
	comp: IrComponent,
	expand: ExpandSpec,
): boolean => {
	const dtstart = componentStartInstant(comp);
	if (dtstart === undefined) {
		return true;
	}
	return (
		Temporal.Instant.compare(dtstart, expand.start) >= 0 &&
		Temporal.Instant.compare(dtstart, expand.end) < 0
	);
};

const componentStartInstant = (
	comp: IrComponent,
): Temporal.Instant | undefined => {
	const dtstartProp = comp.properties.find((p) => p.name === "DTSTART");
	if (!dtstartProp) {
		return undefined;
	}
	return valueToInstant(dtstartProp.value);
};

const componentDuration = (
	comp: IrComponent,
): Temporal.Duration | undefined => {
	const dtstartProp = comp.properties.find((p) => p.name === "DTSTART");
	const dtendProp = comp.properties.find(
		(p) => p.name === "DTEND" || p.name === "DUE",
	);
	if (dtstartProp && dtendProp) {
		const startI = valueToInstant(dtstartProp.value);
		const endI = valueToInstant(dtendProp.value);
		if (startI && endI) {
			return endI.since(startI);
		}
	}
	const durationProp = comp.properties.find((p) => p.name === "DURATION");
	if (durationProp?.value.type === "DURATION") {
		try {
			return Temporal.Duration.from(durationProp.value.value);
		} catch {
			return undefined;
		}
	}
	return undefined;
};

const valueToInstant = (
	value: IrProperty["value"],
): Temporal.Instant | undefined => {
	if (value.type === "DATE_TIME") {
		return value.value.toInstant();
	}
	if (value.type === "DATE") {
		return value.value.toZonedDateTime({
			timeZone: "UTC",
			plainTime: "00:00:00",
		}).toInstant();
	}
	if (value.type === "PLAIN_DATE_TIME") {
		return value.value.toZonedDateTime("UTC").toInstant();
	}
	return undefined;
};


/** Build a new scheduling component for an occurrence at `start`. */
const buildExpandedInstance = (
	master: IrComponent,
	start: Temporal.Instant,
	duration: Temporal.Duration | undefined,
): IrComponent => {
	const preserved = master.properties.filter(
		(p) => !EXPAND_DROPPED_PROPS.has(p.name),
	);
	const newProps: Array<IrProperty> = preserved.map((p) => stripTzidParam(p));

	const startZdt = start.toZonedDateTimeISO("UTC");
	newProps.push({
		name: "DTSTART",
		parameters: [],
		value: { type: "DATE_TIME", value: startZdt },
		isKnown: true,
	});
	if (duration !== undefined) {
		const end = start.add(duration);
		const endZdt = end.toZonedDateTimeISO("UTC");
		// VEVENT uses DTEND, VTODO uses DUE. Default to DTEND for everything else.
		newProps.push({
			name: master.name === "VTODO" ? "DUE" : "DTEND",
			parameters: [],
			value: { type: "DATE_TIME", value: endZdt },
			isKnown: true,
		});
	}
	// RFC 4791 §9.6.5 ¶3.5: each expanded instance carries RECURRENCE-ID set to
	// its occurrence's original DTSTART (in UTC).
	newProps.push({
		name: "RECURRENCE-ID",
		parameters: [],
		value: { type: "DATE_TIME", value: startZdt },
		isKnown: true,
	});

	return {
		...master,
		properties: newProps,
		// Sub-components (VALARM etc.) flow through unchanged.
	};
};

/** Rewrite DTSTART/DTEND/RECURRENCE-ID to UTC for an already-single-occurrence component. */
const rewriteToUtc = (comp: IrComponent): IrComponent => {
	const rewritten: Array<IrProperty> = [];
	for (const prop of comp.properties) {
		if (
			prop.name !== "DTSTART" &&
			prop.name !== "DTEND" &&
			prop.name !== "DUE" &&
			prop.name !== "RECURRENCE-ID"
		) {
			rewritten.push(prop);
			continue;
		}
		const instant = valueToInstant(prop.value);
		if (instant === undefined) {
			rewritten.push(prop);
			continue;
		}
		rewritten.push({
			name: prop.name,
			parameters: prop.parameters.filter(
				(pm) => pm.name.toUpperCase() !== "TZID",
			),
			value: {
				type: "DATE_TIME",
				value: instant.toZonedDateTimeISO("UTC"),
			},
			isKnown: true,
		});
	}
	return { ...comp, properties: rewritten };
};

/** Drop a TZID parameter from a non-date property cloned into an expanded instance. */
const stripTzidParam = (prop: IrProperty): IrProperty =>
	prop.parameters.some((p) => p.name.toUpperCase() === "TZID")
		? {
				...prop,
				parameters: prop.parameters.filter(
					(p) => p.name.toUpperCase() !== "TZID",
				),
			}
		: prop;


const subsetComponent = (comp: IrComponent, spec: CompSpec): IrComponent => {
	// Properties: keep all if allProps, or filter to spec.props + always-required ones
	const properties = spec.allProps
		? comp.properties
		: comp.properties.filter(
				(p) =>
					spec.props.has(p.name) || isAlwaysRequiredProp(comp.name, p.name),
			);

	// Sub-components
	let components: ReadonlyArray<IrComponent>;
	if (spec.comps.length === 0) {
		// No explicit comp children → keep all sub-components unchanged
		components = comp.components;
	} else {
		components = comp.components.flatMap((sub) => {
			// VTIMEZONE is always included (needed to interpret TZID= references)
			if (sub.name === "VTIMEZONE") {
				return [sub];
			}
			const subSpec = spec.comps.find((c) => c.name === sub.name);
			if (!subSpec) {
				return [];
			}
			return [subsetComponent(sub, subSpec)];
		});
	}

	return { ...comp, properties, components };
};

// ---------------------------------------------------------------------------
// stripKnownVtimezones — RFC 7809 §3.1.3 (CalDAV-Timezones: F)
// ---------------------------------------------------------------------------

/**
 * Remove VTIMEZONE sub-components from a VCALENDAR IrDocument whose TZID is
 * a standard IANA timezone known to the server.
 *
 * Called when the client sends `CalDAV-Timezones: F`, indicating it will fetch
 * timezone definitions from the advertised timezone service rather than
 * expecting them to be embedded. VTIMEZONE components for custom or unknown
 * TZIDs are always preserved so clients can still interpret them.
 */
export const stripKnownVtimezones = (
	doc: IrDocument,
	isKnownTzid: (tzid: string) => boolean,
): IrDocument => {
	if (doc.kind !== "icalendar") {
		return doc;
	}
	const root = doc.root;
	const filteredComponents = root.components.filter((sub) => {
		if (sub.name !== "VTIMEZONE") {
			return true;
		}
		const tzidProp = sub.properties.find((p) => p.name === "TZID");
		if (!tzidProp) {
			// Malformed VTIMEZONE without TZID — keep it to avoid data loss.
			return true;
		}
		const tzid = tzidProp.value.type === "TEXT" ? tzidProp.value.value : null;
		if (tzid === null) {
			return true;
		}
		// Strip only if the TZID is a known IANA timezone.
		return !isKnownTzid(tzid);
	});
	return { ...doc, root: { ...root, components: filteredComponents } };
};

/**
 * Properties that must always be included regardless of the spec.
 * RFC 4791 §8.6.1: VERSION/PRODID in VCALENDAR are always returned.
 * RFC 4791 §9.6.1: UID and RECURRENCE-ID must always be returned in calendar components.
 */
const isAlwaysRequiredProp = (compName: string, propName: string): boolean => {
	if (
		compName === "VCALENDAR" &&
		(propName === "VERSION" || propName === "PRODID")
	) {
		return true;
	}
	if (
		(compName === "VEVENT" ||
			compName === "VTODO" ||
			compName === "VJOURNAL") &&
		(propName === "UID" || propName === "RECURRENCE-ID")
	) {
		return true;
	}
	return false;
};
