import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import type { IrComponent, IrDocument, IrProperty } from "#src/data/ir.ts";
import {
	applyFieldVisibility,
	BUSY_SUMMARY,
	redactDocumentToBusyOnly,
} from "./visibility.ts";

const textProp = (name: string, value: string): IrProperty => ({
	name,
	parameters: [],
	value: { type: "TEXT", value },
	isKnown: true,
});

const vevent = (): IrComponent => ({
	name: "VEVENT",
	properties: [
		textProp("UID", "event-1"),
		textProp("SUMMARY", "Board meeting"),
		textProp("DESCRIPTION", "Confidential quarterly numbers"),
		textProp("LOCATION", "CEO's office"),
		textProp("ATTENDEE", "mailto:alice@example.com"),
		textProp("ORGANIZER", "mailto:bob@example.com"),
		textProp("DTSTART", "20260101T090000Z"),
		textProp("DTEND", "20260101T100000Z"),
		textProp("STATUS", "CONFIRMED"),
		textProp("TRANSP", "OPAQUE"),
	],
	components: [],
});

const vtimezone = (): IrComponent => ({
	name: "VTIMEZONE",
	properties: [textProp("TZID", "America/New_York")],
	components: [],
});

const veventWithAlarm = (): IrComponent => ({
	...vevent(),
	components: [
		{
			name: "VALARM",
			properties: [
				textProp("ACTION", "DISPLAY"),
				textProp("DESCRIPTION", "Reminder: confidential board meeting"),
			],
			components: [],
		},
	],
});

describe("applyFieldVisibility", () => {
	it("returns the component unchanged for 'full'", () => {
		const component = vevent();
		expect(applyFieldVisibility(component, "full")).toBe(component);
	});

	it("strips private fields but keeps SUMMARY for 'titled'", () => {
		const result = applyFieldVisibility(vevent(), "titled");
		const names = result.properties.map((p) => p.name);
		expect(names).toContain("SUMMARY");
		expect(names).not.toContain("DESCRIPTION");
		expect(names).not.toContain("LOCATION");
		expect(names).not.toContain("ATTENDEE");
		expect(names).not.toContain("ORGANIZER");
		const summary = result.properties.find((p) => p.name === "SUMMARY");
		expect(summary?.value).toEqual({ type: "TEXT", value: "Board meeting" });
	});

	it("strips private fields and replaces SUMMARY with 'Busy' for 'busy_only'", () => {
		const result = applyFieldVisibility(vevent(), "busy_only");
		const names = result.properties.map((p) => p.name);
		expect(names).not.toContain("DESCRIPTION");
		expect(names).not.toContain("LOCATION");
		expect(names).not.toContain("ATTENDEE");
		expect(names).not.toContain("ORGANIZER");
		const summaries = result.properties.filter((p) => p.name === "SUMMARY");
		expect(summaries).toHaveLength(1);
		expect(summaries[0]?.value).toEqual({ type: "TEXT", value: BUSY_SUMMARY });
	});

	it("strips private fields from nested components (e.g. VALARM) too", () => {
		const result = applyFieldVisibility(veventWithAlarm(), "busy_only");
		const alarm = result.components.find((c) => c.name === "VALARM");
		const names = alarm?.properties.map((p) => p.name) ?? [];
		expect(names).not.toContain("DESCRIPTION");
		expect(names).toContain("ACTION");
	});

	it("leaves scheduling-relevant fields untouched for 'busy_only'", () => {
		const result = applyFieldVisibility(vevent(), "busy_only");
		const names = result.properties.map((p) => p.name);
		expect(names).toContain("UID");
		expect(names).toContain("DTSTART");
		expect(names).toContain("DTEND");
		expect(names).toContain("STATUS");
		expect(names).toContain("TRANSP");
	});
});

describe("redactDocumentToBusyOnly", () => {
	const doc = (): IrDocument => ({
		kind: "icalendar",
		root: {
			name: "VCALENDAR",
			properties: [],
			components: [vevent(), vtimezone()],
		},
	});

	it("redacts every non-VTIMEZONE sub-component", () => {
		const result = redactDocumentToBusyOnly(doc());
		const eventComp = result.root.components.find((c) => c.name === "VEVENT");
		const names = eventComp?.properties.map((p) => p.name) ?? [];
		expect(names).not.toContain("DESCRIPTION");
		const summary = eventComp?.properties.find((p) => p.name === "SUMMARY");
		expect(summary?.value).toEqual({ type: "TEXT", value: BUSY_SUMMARY });
	});

	it("leaves VTIMEZONE sub-components untouched", () => {
		const result = redactDocumentToBusyOnly(doc());
		const tz = result.root.components.find((c) => c.name === "VTIMEZONE");
		expect(tz?.properties).toEqual(vtimezone().properties);
	});
});
