import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
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
