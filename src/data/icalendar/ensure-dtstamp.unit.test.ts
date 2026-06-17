import { describe, expect, it } from "bun:test";
import { ensureDtstamp } from "#src/data/icalendar/ensure-dtstamp.ts";
import type { IrComponent, IrDocument, IrProperty } from "#src/data/ir.ts";

const prop = (name: string, text: string): IrProperty => ({
	name,
	parameters: [],
	value: { type: "TEXT", value: text },
	isKnown: true,
});

const comp = (
	name: string,
	properties: Array<IrProperty> = [],
	components: Array<IrComponent> = [],
): IrComponent => ({ name, properties, components });

const ical = (root: IrComponent): IrDocument => ({ kind: "icalendar", root });

const dtstampNames = (c: IrComponent): Array<string> =>
	c.properties.filter((p) => p.name === "DTSTAMP").map((p) => p.value.type);

describe("ensureDtstamp", () => {
	it("adds DTSTAMP to a VEVENT that lacks it", () => {
		const out = ensureDtstamp(
			ical(comp("VCALENDAR", [], [comp("VEVENT", [prop("UID", "x")])])),
		);
		const vevent = out.root.components[0];
		expect(vevent?.properties.some((p) => p.name === "DTSTAMP")).toBe(true);
		expect(dtstampNames(vevent as IrComponent)).toEqual(["DATE_TIME"]);
	});

	it("preserves a client-supplied DTSTAMP (no duplicate)", () => {
		const existing: IrProperty = {
			name: "DTSTAMP",
			parameters: [],
			value: { type: "TEXT", value: "20200101T000000Z" },
			isKnown: true,
		};
		const out = ensureDtstamp(
			ical(
				comp("VCALENDAR", [], [comp("VEVENT", [prop("UID", "x"), existing])]),
			),
		);
		const stamps = (out.root.components[0]?.properties ?? []).filter(
			(p) => p.name === "DTSTAMP",
		);
		expect(stamps).toHaveLength(1);
		expect(stamps[0]).toBe(existing);
	});

	it("stamps VTODO/VJOURNAL/VFREEBUSY but not VTIMEZONE/VALARM", () => {
		const out = ensureDtstamp(
			ical(
				comp(
					"VCALENDAR",
					[],
					[
						comp("VTODO", [prop("UID", "t")]),
						comp("VJOURNAL", [prop("UID", "j")]),
						comp("VFREEBUSY", []),
						comp("VTIMEZONE", [prop("TZID", "UTC")]),
						comp("VEVENT", [prop("UID", "e")], [comp("VALARM", [])]),
					],
				),
			),
		);
		const byName = (n: string) =>
			out.root.components.find((c) => c.name === n) as IrComponent;
		const has = (c: IrComponent) =>
			c.properties.some((p) => p.name === "DTSTAMP");
		expect(has(byName("VTODO"))).toBe(true);
		expect(has(byName("VJOURNAL"))).toBe(true);
		expect(has(byName("VFREEBUSY"))).toBe(true);
		expect(has(byName("VTIMEZONE"))).toBe(false);
		// the nested VALARM must not be stamped
		const valarm = byName("VEVENT").components[0] as IrComponent;
		expect(has(valarm)).toBe(false);
	});

	it("leaves vCard documents untouched", () => {
		const vcard: IrDocument = {
			kind: "vcard",
			root: comp("VCARD", [prop("FN", "Jane")]),
		};
		expect(ensureDtstamp(vcard)).toBe(vcard);
	});
});
