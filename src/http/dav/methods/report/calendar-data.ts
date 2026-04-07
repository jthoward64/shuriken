// ---------------------------------------------------------------------------
// calendar-data subsetting — RFC 4791 §8.6
//
// Parses <C:calendar-data> elements from REPORT request bodies and applies
// the described component/property filters to an IrDocument before serialization.
// ---------------------------------------------------------------------------

import type { IrComponent, IrDocument } from "#src/data/ir.ts";

const CALDAV_NS = "urn:ietf:params:xml:ns:caldav";
const cn = (local: string): string => `{${CALDAV_NS}}${local}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalendarDataSpec {
	/** If true, return the full IrDocument without subsetting. */
	readonly allProps: boolean;
	readonly compSpec?: CompSpec;
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
	const compEl = (tree as Record<string, unknown>)[cn("comp")];
	if (!compEl) {
		return { allProps: true };
	}
	return { allProps: false, compSpec: parseCompSpec(compEl) };
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
	if (spec.allProps || !spec.compSpec) {
		return doc;
	}
	return { ...doc, root: subsetComponent(doc.root, spec.compSpec) };
};

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

/**
 * Properties that must always be included regardless of the spec.
 * RFC 4791 §8.6.1: VERSION in VCALENDAR is always returned.
 */
const isAlwaysRequiredProp = (compName: string, propName: string): boolean => {
	if (
		compName === "VCALENDAR" &&
		(propName === "VERSION" || propName === "PRODID")
	) {
		return true;
	}
	return false;
};
