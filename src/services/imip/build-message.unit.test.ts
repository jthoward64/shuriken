import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import { resolutionZone } from "#src/data/icalendar/resolve-floating.ts";
import type { IrComponent } from "#src/data/ir.ts";
import {
	buildImipMessage,
	extractAttendeeAddresses,
	isLocalAddress,
} from "./build-message.ts";

const sampleVevent = (): IrComponent => ({
	name: "VEVENT",
	properties: [
		{
			name: "UID",
			parameters: [],
			value: { type: "TEXT", value: "evt-1@shuriken" },
			isKnown: true,
		},
		{
			name: "SUMMARY",
			parameters: [],
			value: { type: "TEXT", value: "Lunch" },
			isKnown: true,
		},
		{
			name: "DTSTART",
			parameters: [],
			value: { type: "DATE", value: Temporal.PlainDate.from("2026-06-01") },
			isKnown: true,
		},
		{
			name: "ATTENDEE",
			parameters: [],
			value: { type: "URI", value: "mailto:bob@remote.example" },
			isKnown: true,
		},
		{
			name: "ATTENDEE",
			parameters: [],
			value: { type: "URI", value: "mailto:alice@local.example" },
			isKnown: true,
		},
	],
	components: [],
});

describe("buildImipMessage", () => {
	it("builds a REQUEST envelope with method-bearing VCALENDAR", async () => {
		const msg = await Effect.runPromise(
			buildImipMessage({
				method: "REQUEST",
				vevent: sampleVevent(),
				to: ["bob@remote.example"],
			}),
		);
		expect(msg.to).toEqual(["bob@remote.example"]);
		expect(msg.subject).toBe("Invitation: Lunch");
		expect(msg.contentType).toBe(
			"text/calendar; method=REQUEST; charset=utf-8",
		);
		expect(msg.text).toContain("METHOD:REQUEST");
		expect(msg.text).toContain("BEGIN:VEVENT");
		expect(msg.text).toContain("UID:evt-1@shuriken");
	});

	it("builds CANCEL with appropriate subject prefix", async () => {
		const msg = await Effect.runPromise(
			buildImipMessage({
				method: "CANCEL",
				vevent: sampleVevent(),
				to: ["bob@remote.example"],
			}),
		);
		expect(msg.subject).toBe("Cancelled: Lunch");
		expect(msg.text).toContain("METHOD:CANCEL");
	});
});

describe("extractAttendeeAddresses", () => {
	it("strips mailto: prefix", () => {
		const addrs = extractAttendeeAddresses(sampleVevent());
		expect(addrs).toEqual(["bob@remote.example", "alice@local.example"]);
	});
});

describe("isLocalAddress", () => {
	it("matches by case-insensitive domain", () => {
		expect(isLocalAddress("alice@LOCAL.example", ["local.example"])).toBe(true);
		expect(isLocalAddress("bob@remote.example", ["local.example"])).toBe(false);
		expect(isLocalAddress("malformed", ["local.example"])).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Floating-time anchoring — a floating DTSTART would otherwise be read as the
// recipient's own local time, which is the wrong instant for an invitation.
// ---------------------------------------------------------------------------

const floatingVevent = (): IrComponent => ({
	name: "VEVENT",
	properties: [
		{
			name: "UID",
			parameters: [],
			value: { type: "TEXT", value: "evt-2@shuriken" },
			isKnown: true,
		},
		{
			name: "SUMMARY",
			parameters: [],
			value: { type: "TEXT", value: "Standup" },
			isKnown: true,
		},
		{
			name: "DTSTART",
			parameters: [],
			value: {
				type: "PLAIN_DATE_TIME",
				value: Temporal.PlainDateTime.from("2026-06-01T09:00"),
			},
			isKnown: true,
		},
		{
			name: "DTEND",
			parameters: [],
			value: {
				type: "PLAIN_DATE_TIME",
				value: Temporal.PlainDateTime.from("2026-06-01T09:30"),
			},
			isKnown: true,
		},
	],
	components: [],
});

const berlinVtimezone = (): IrComponent => ({
	name: "VTIMEZONE",
	properties: [
		{
			name: "TZID",
			parameters: [],
			value: { type: "TEXT", value: "Europe/Berlin" },
			isKnown: true,
		},
	],
	components: [],
});

describe("buildImipMessage — floating time anchoring", () => {
	it("anchors a floating DTSTART to the calendar's zone with a TZID", async () => {
		const msg = await Effect.runPromise(
			buildImipMessage({
				method: "REQUEST",
				vevent: floatingVevent(),
				to: ["bob@remote.example"],
				zone: resolutionZone("Europe/Berlin"),
				vtimezone: berlinVtimezone(),
			}),
		);
		expect(msg.text).toContain("DTSTART;TZID=Europe/Berlin:20260601T090000");
		expect(msg.text).toContain("DTEND;TZID=Europe/Berlin:20260601T093000");
		// The VTIMEZONE must travel with it or the TZID is unresolvable
		expect(msg.text).toContain("BEGIN:VTIMEZONE");
		expect(msg.text).toContain("TZID:Europe/Berlin");
	});

	it("falls back to UTC, which needs no VTIMEZONE", async () => {
		const msg = await Effect.runPromise(
			buildImipMessage({
				method: "REQUEST",
				vevent: floatingVevent(),
				to: ["bob@remote.example"],
			}),
		);
		expect(msg.text).toContain("DTSTART:20260601T090000Z");
		expect(msg.text).not.toContain("TZID");
		expect(msg.text).not.toContain("BEGIN:VTIMEZONE");
	});

	// An all-day DTSTART is genuinely date-only; TZID is invalid on a DATE value
	it("leaves an all-day DATE value untouched", async () => {
		const msg = await Effect.runPromise(
			buildImipMessage({
				method: "REQUEST",
				vevent: sampleVevent(),
				to: ["bob@remote.example"],
				zone: resolutionZone("Europe/Berlin"),
				vtimezone: berlinVtimezone(),
			}),
		);
		// Unchanged: no TZID parameter, and the date is emitted as-is
		expect(msg.text).toContain("DTSTART:20260601\r\n");
		expect(msg.text).not.toContain("TZID");
		expect(msg.text).not.toContain("BEGIN:VTIMEZONE");
	});

	// A DTSTART the organizer already pinned must not be rewritten
	it("leaves an already-zoned DTSTART alone", async () => {
		const base = floatingVevent();
		const zoned: IrComponent = {
			...base,
			properties: base.properties.map((p) =>
				p.name === "DTSTART"
					? {
							...p,
							parameters: [{ name: "TZID", value: "America/New_York" }],
							value: {
								type: "DATE_TIME" as const,
								value: Temporal.ZonedDateTime.from(
									"2026-06-01T09:00:00[America/New_York]",
								),
							},
						}
					: p,
			),
		};
		const msg = await Effect.runPromise(
			buildImipMessage({
				method: "REQUEST",
				vevent: zoned,
				to: ["bob@remote.example"],
				zone: resolutionZone("Europe/Berlin"),
				vtimezone: berlinVtimezone(),
			}),
		);
		expect(msg.text).toContain("DTSTART;TZID=America/New_York:20260601T090000");
	});
});

describe("buildImipMessage — RRULE UNTIL follows DTSTART's form", () => {
	// RFC 5545 section 3.3.10: UNTIL must match DTSTART's form. build-vevent.ts
	// writes a floating UNTIL to match a floating DTSTART, so anchoring DTSTART
	// for an invitation has to carry UNTIL over to UTC with it.
	const recurring = (rrule: string): IrComponent => ({
		name: "VEVENT",
		properties: [
			{
				name: "UID",
				parameters: [],
				value: { type: "TEXT", value: "evt-rrule@shuriken" },
				isKnown: true,
			},
			{
				name: "DTSTART",
				parameters: [],
				value: {
					type: "PLAIN_DATE_TIME",
					value: Temporal.PlainDateTime.from("2026-09-16T09:00:00"),
				},
				isKnown: true,
			},
			{
				name: "RRULE",
				parameters: [],
				value: { type: "RECUR", value: rrule },
				isKnown: true,
			},
			{
				name: "ATTENDEE",
				parameters: [],
				value: { type: "URI", value: "mailto:bob@remote.example" },
				isKnown: true,
			},
		],
		components: [],
	});

	// Build the iMIP message for a recurring event in the given zone
	const build = async (rrule: string, tzid: string) =>
		await Effect.runPromise(
			buildImipMessage({
				method: "REQUEST",
				vevent: recurring(rrule),
				to: ["bob@remote.example"],
				zone: resolutionZone(tzid),
			}),
		);

	it("rewrites a floating UNTIL to UTC when DTSTART is anchored", async () => {
		const msg = await build(
			"FREQ=WEEKLY;UNTIL=20261216T090000",
			"Europe/Berlin",
		);
		expect(msg.text).toContain("DTSTART;TZID=Europe/Berlin:20260916T090000");
		// 09:00 Berlin in December is CET (UTC+1)
		expect(msg.text).toContain("UNTIL=20261216T080000Z");
	});

	it("leaves an already-UTC UNTIL alone", async () => {
		const msg = await build(
			"FREQ=WEEKLY;UNTIL=20261216T080000Z",
			"Europe/Berlin",
		);
		expect(msg.text).toContain("UNTIL=20261216T080000Z");
	});

	it("leaves a date-only UNTIL alone", async () => {
		const msg = await build("FREQ=WEEKLY;UNTIL=20261216", "Europe/Berlin");
		expect(msg.text).toContain("UNTIL=20261216");
	});

	it("still emits UTC when the anchoring zone is UTC", async () => {
		// DTSTART gains a trailing Z rather than a TZID, and UNTIL must match
		const msg = await build("FREQ=WEEKLY;UNTIL=20261216T090000", "UTC");
		expect(msg.text).toContain("DTSTART:20260916T090000Z");
		expect(msg.text).toContain("UNTIL=20261216T090000Z");
	});

	it("does not invent an UNTIL for a COUNT-bounded rule", async () => {
		const msg = await build("FREQ=WEEKLY;COUNT=5", "Europe/Berlin");
		expect(msg.text).toContain("RRULE:FREQ=WEEKLY;COUNT=5");
	});
});
