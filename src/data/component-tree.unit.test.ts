import { describe, expect, it } from "bun:test";
import { Effect, Schema } from "effect";
import { runFailure } from "#src/testing/effect.ts";
import type { ContentLine } from "./content-line.ts";
import {
	RawComponentCodec,
	TextToRawComponentCodec,
} from "./component-tree.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const decodeLines = Schema.decode(RawComponentCodec);
const encodeLines = Schema.encode(RawComponentCodec);
const decodeText = Schema.decode(TextToRawComponentCodec);

const dec = (lines: ReadonlyArray<ContentLine>) =>
	Effect.runPromise(decodeLines(lines));
const enc = (component: Parameters<typeof encodeLines>[0]) =>
	Effect.runPromise(encodeLines(component));
const decText = (text: string) => Effect.runPromise(decodeText(text));

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

describe("RawComponentCodec decode", () => {
	it("decodes a flat ContentLine sequence into a root component", async () => {
		const lines: ReadonlyArray<ContentLine> = [
			{ name: "BEGIN", params: [], rawValue: "VCALENDAR" },
			{ name: "VERSION", params: [], rawValue: "2.0" },
			{ name: "END", params: [], rawValue: "VCALENDAR" },
		];
		const root = await dec(lines);
		expect(root.name).toBe("VCALENDAR");
		expect(root.contentLines).toHaveLength(1);
		expect(root.contentLines[0]).toMatchObject({ name: "VERSION" });
		expect(root.children).toHaveLength(0);
	});

	it("attaches property lines to the correct component", async () => {
		const lines: ReadonlyArray<ContentLine> = [
			{ name: "BEGIN", params: [], rawValue: "VCALENDAR" },
			{ name: "VERSION", params: [], rawValue: "2.0" },
			{ name: "BEGIN", params: [], rawValue: "VEVENT" },
			{ name: "DTSTART", params: [], rawValue: "20240101T090000Z" },
			{ name: "SUMMARY", params: [], rawValue: "Meeting" },
			{ name: "END", params: [], rawValue: "VEVENT" },
			{ name: "END", params: [], rawValue: "VCALENDAR" },
		];
		const root = await dec(lines);
		expect(root.name).toBe("VCALENDAR");
		// VERSION belongs to VCALENDAR, not VEVENT
		expect(root.contentLines).toHaveLength(1);
		expect(root.contentLines[0]).toMatchObject({ name: "VERSION" });
		// VEVENT is a child
		expect(root.children).toHaveLength(1);
		const vevent = root.children[0];
		expect(vevent?.name).toBe("VEVENT");
		expect(vevent?.contentLines).toHaveLength(2);
	});

	it("nests children at arbitrary depth", async () => {
		const lines: ReadonlyArray<ContentLine> = [
			{ name: "BEGIN", params: [], rawValue: "VCALENDAR" },
			{ name: "BEGIN", params: [], rawValue: "VTIMEZONE" },
			{ name: "BEGIN", params: [], rawValue: "STANDARD" },
			{ name: "TZNAME", params: [], rawValue: "EST" },
			{ name: "END", params: [], rawValue: "STANDARD" },
			{ name: "END", params: [], rawValue: "VTIMEZONE" },
			{ name: "END", params: [], rawValue: "VCALENDAR" },
		];
		const root = await dec(lines);
		const tz = root.children[0];
		expect(tz?.name).toBe("VTIMEZONE");
		const std = tz?.children[0];
		expect(std?.name).toBe("STANDARD");
		expect(std?.contentLines[0]).toMatchObject({ name: "TZNAME" });
	});

	it("fails when END name does not match the open BEGIN", async () => {
		const lines: ReadonlyArray<ContentLine> = [
			{ name: "BEGIN", params: [], rawValue: "VCALENDAR" },
			{ name: "END", params: [], rawValue: "VEVENT" },
		];
		const err = await runFailure(decodeLines(lines));
		expect(err._tag).toBe("ParseError");
	});

	it("fails when there are multiple root components", async () => {
		const lines: ReadonlyArray<ContentLine> = [
			{ name: "BEGIN", params: [], rawValue: "VCALENDAR" },
			{ name: "END", params: [], rawValue: "VCALENDAR" },
			{ name: "BEGIN", params: [], rawValue: "VCALENDAR" },
			{ name: "END", params: [], rawValue: "VCALENDAR" },
		];
		const err = await runFailure(decodeLines(lines));
		expect(err._tag).toBe("ParseError");
	});

	it("fails when there are unclosed components", async () => {
		const lines: ReadonlyArray<ContentLine> = [
			{ name: "BEGIN", params: [], rawValue: "VCALENDAR" },
			{ name: "VERSION", params: [], rawValue: "2.0" },
		];
		const err = await runFailure(decodeLines(lines));
		expect(err._tag).toBe("ParseError");
	});

	it("fails when a property line appears outside any component", async () => {
		const lines: ReadonlyArray<ContentLine> = [
			{ name: "VERSION", params: [], rawValue: "2.0" },
		];
		const err = await runFailure(decodeLines(lines));
		expect(err._tag).toBe("ParseError");
	});
});

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

describe("RawComponentCodec encode", () => {
	it("emits BEGIN:name, contentLines, children, END:name in order", async () => {
		const component = {
			name: "VCALENDAR",
			contentLines: [{ name: "VERSION", params: [], rawValue: "2.0" }] as const,
			children: [
				{
					name: "VEVENT",
					contentLines: [
						{ name: "SUMMARY", params: [], rawValue: "Test" },
					] as const,
					children: [],
				},
			],
		};
		const lines = await enc(component);
		expect(lines[0]).toMatchObject({ name: "BEGIN", rawValue: "VCALENDAR" });
		expect(lines[1]).toMatchObject({ name: "VERSION" });
		expect(lines[2]).toMatchObject({ name: "BEGIN", rawValue: "VEVENT" });
		expect(lines[3]).toMatchObject({ name: "SUMMARY" });
		expect(lines[4]).toMatchObject({ name: "END", rawValue: "VEVENT" });
		expect(lines[5]).toMatchObject({ name: "END", rawValue: "VCALENDAR" });
	});
});

// ---------------------------------------------------------------------------
// Round-trips
// ---------------------------------------------------------------------------

describe("RawComponentCodec round-trip", () => {
	it("decode → encode → decode yields the same RawComponent tree", async () => {
		const lines: ReadonlyArray<ContentLine> = [
			{ name: "BEGIN", params: [], rawValue: "VCALENDAR" },
			{ name: "VERSION", params: [], rawValue: "2.0" },
			{ name: "BEGIN", params: [], rawValue: "VEVENT" },
			{ name: "DTSTART", params: [{ name: "TZID", values: ["America/New_York"] }], rawValue: "19980119T020000" },
			{ name: "END", params: [], rawValue: "VEVENT" },
			{ name: "END", params: [], rawValue: "VCALENDAR" },
		];
		const tree1 = await dec(lines);
		const reencoded = await enc(tree1);
		const tree2 = await dec(reencoded);
		expect(tree2).toEqual(tree1);
	});
});

// ---------------------------------------------------------------------------
// TextToRawComponentCodec (composed string → RawComponent)
// ---------------------------------------------------------------------------

describe("TextToRawComponentCodec", () => {
	it("parses a CRLF iCalendar string directly to a RawComponent tree", async () => {
		const text =
			"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nSUMMARY:Test\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
		const root = await decText(text);
		expect(root.name).toBe("VCALENDAR");
		expect(root.children[0]?.name).toBe("VEVENT");
	});
});
