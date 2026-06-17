import { Temporal } from "temporal-polyfill";
import type { IrComponent, IrDocument, IrProperty } from "#src/data/ir.ts";

// RFC 5545 §3.6: DTSTAMP is REQUIRED in these components.
const DTSTAMP_REQUIRED: ReadonlySet<string> = new Set([
	"VEVENT",
	"VTODO",
	"VJOURNAL",
	"VFREEBUSY",
]);

const makeDtstamp = (): IrProperty => ({
	name: "DTSTAMP",
	parameters: [],
	value: { type: "DATE_TIME", value: Temporal.Now.zonedDateTimeISO("UTC") },
	isKnown: true,
});

/**
 * Ensure every component that RFC 5545 requires to carry DTSTAMP has one.
 *
 * Clients sometimes omit DTSTAMP, which would leave us storing — and serving
 * back — invalid iCalendar. For a stored calendar object (no METHOD property)
 * DTSTAMP is defined as "the date and time that the information ... was last
 * revised in the calendar store" (RFC 5545 §3.8.7.2) — i.e. a server-owned
 * value — so filling a missing one with the store time is conformant. A
 * client-supplied DTSTAMP is preserved unchanged. Non-iCalendar documents and
 * components that don't require DTSTAMP (VTIMEZONE, VALARM, …) are untouched.
 */
export const ensureDtstamp = (doc: IrDocument): IrDocument => {
	if (doc.kind !== "icalendar") {
		return doc;
	}
	const stamp = makeDtstamp();
	const fix = (comp: IrComponent): IrComponent => {
		const needsStamp =
			DTSTAMP_REQUIRED.has(comp.name) &&
			!comp.properties.some((p) => p.name === "DTSTAMP");
		return {
			...comp,
			properties: needsStamp ? [...comp.properties, stamp] : comp.properties,
			components: comp.components.map(fix),
		};
	};
	return { ...doc, root: fix(doc.root) };
};
