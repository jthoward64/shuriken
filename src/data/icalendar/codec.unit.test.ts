import { describe, expect, it } from "bun:test";
import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import { runFailure } from "#src/testing/effect.ts";
import { decodeICalendar, encodeICalendar } from "./codec.ts";
import { extractUid } from "./uid.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ical = (...lines: Array<string>) => `${lines.join("\r\n")}\r\n`;

const run = (text: string) => Effect.runPromise(decodeICalendar(text));
const enc = (doc: Parameters<typeof encodeICalendar>[0]) =>
	Effect.runPromise(encodeICalendar(doc));

const minimalVevent = ical(
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"PRODID:-//Test//EN",
	"BEGIN:VEVENT",
	"UID:test-uid-1@example.com",
	"DTSTAMP:20060717T210714Z",
	"DTSTART:20060718T000000Z",
	"SUMMARY:Test Event",
	"END:VEVENT",
	"END:VCALENDAR",
);

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

describe("ICalendarCodec decode", () => {
	it("decodes a minimal VCALENDAR with one VEVENT", async () => {
		const doc = await run(minimalVevent);
		expect(doc.kind).toBe("icalendar");
		expect(doc.root.name).toBe("VCALENDAR");
		expect(doc.root.components).toHaveLength(1);
		expect(doc.root.components[0]?.name).toBe("VEVENT");
	});

	it("types DTSTART as DATE when VALUE=DATE parameter is present", async () => {
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:date-test@example.com",
			"DTSTAMP:20060717T210714Z",
			"DTSTART;VALUE=DATE:20060102",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		const vevent = doc.root.components[0];
		const dtstart = vevent?.properties.find((p) => p.name === "DTSTART");
		expect(dtstart?.value.type).toBe("DATE");
		if (dtstart?.value.type === "DATE") {
			expect(dtstart.value.value.year).toBe(2006);
			expect(dtstart.value.value.month).toBe(1);
			expect(dtstart.value.value.day).toBe(2);
		}
	});

	it("types DTSTART as DATE_TIME with ZonedDateTime when TZID parameter is present", async () => {
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:tzid-test@example.com",
			"DTSTAMP:20060717T210714Z",
			"DTSTART;TZID=America/New_York:20060102T150405",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		const vevent = doc.root.components[0];
		const dtstart = vevent?.properties.find((p) => p.name === "DTSTART");
		expect(dtstart?.value.type).toBe("DATE_TIME");
		if (dtstart?.value.type === "DATE_TIME") {
			expect(dtstart.value.value.timeZoneId).toBe("America/New_York");
			expect(dtstart.value.value.year).toBe(2006);
			expect(dtstart.value.value.hour).toBe(15);
		}
	});

	it("types DTSTART as PLAIN_DATE_TIME when no Z or TZID is present", async () => {
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:floating-test@example.com",
			"DTSTAMP:20060717T210714Z",
			"DTSTART:20060102T150405",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		const vevent = doc.root.components[0];
		const dtstart = vevent?.properties.find((p) => p.name === "DTSTART");
		expect(dtstart?.value.type).toBe("PLAIN_DATE_TIME");
		if (dtstart?.value.type === "PLAIN_DATE_TIME") {
			expect(dtstart.value.value.year).toBe(2006);
			expect(dtstart.value.value.hour).toBe(15);
		}
	});

	it("stores X- properties as TEXT with isKnown: false, verbatim (no unescaping)", async () => {
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:x-test@example.com",
			"DTSTAMP:20060717T210714Z",
			"X-CUSTOM:hello\\,world",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		const vevent = doc.root.components[0];
		const xProp = vevent?.properties.find((p) => p.name === "X-CUSTOM");
		expect(xProp?.isKnown).toBe(false);
		expect(xProp?.value.type).toBe("TEXT");
		// rawValue stored verbatim — backslash escape NOT decoded
		if (xProp?.value.type === "TEXT") {
			expect(xProp.value.value).toBe("hello\\,world");
		}
	});

	it("unescapes TEXT values for known properties", async () => {
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:escape-test@example.com",
			"DTSTAMP:20060717T210714Z",
			"SUMMARY:Hello\\, World",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		const vevent = doc.root.components[0];
		const summary = vevent?.properties.find((p) => p.name === "SUMMARY");
		expect(summary?.value.type).toBe("TEXT");
		if (summary?.value.type === "TEXT") {
			expect(summary.value.value).toBe("Hello, World");
		}
	});

	it("fails with validCalendarData when root component is not VCALENDAR", async () => {
		const text = ical(
			"BEGIN:VEVENT",
			"UID:bad@example.com",
			"DTSTAMP:20060717T210714Z",
			"END:VEVENT",
		);
		const err = await runFailure(decodeICalendar(text));
		expect(err._tag).toBe("DavError");
		expect(err.precondition).toBe("CALDAV:valid-calendar-data");
	});
});

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

describe("ICalendarCodec encode", () => {
	it("encoded output has every physical line ≤75 UTF-8 octets with CRLF endings", async () => {
		// SUMMARY with long value forces folding
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:fold-test@example.com",
			"DTSTAMP:20060717T210714Z",
			// 80-char summary — forces a fold
			"SUMMARY:This is a very long summary that exceeds the 75-octet line limit fold",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		const out = await enc(doc);
		const encoder = new TextEncoder();
		for (const line of out.split("\r\n").filter((l) => l.length > 0)) {
			expect(encoder.encode(line).byteLength).toBeLessThanOrEqual(75);
		}
		expect(out.endsWith("\r\n")).toBe(true);
	});

	it("emits X-/unknown properties verbatim (no double-escaping)", async () => {
		const xValue = "hello\\,world";
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:verbatim-test@example.com",
			"DTSTAMP:20060717T210714Z",
			`X-CUSTOM:${xValue}`,
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		const out = await enc(doc);
		expect(out).toContain(`X-CUSTOM:${xValue}`);
	});
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("ICalendarCodec round-trip", () => {
	it("decode → encode → decode yields structurally equal IrDocument", async () => {
		const doc1 = await run(minimalVevent);
		const encoded = await enc(doc1);
		const doc2 = await Effect.runPromise(
			Effect.andThen(Effect.succeed(encoded), (t) => decodeICalendar(t)),
		);
		expect(doc2).toEqual(doc1);
	});
});

// ---------------------------------------------------------------------------
// extractUid
// ---------------------------------------------------------------------------

describe("extractUid (iCalendar)", () => {
	it("extracts UID from the first child component", async () => {
		const doc = await run(minimalVevent);
		const uid = extractUid(doc);
		expect(Option.isSome(uid)).toBe(true);
		expect(Option.getOrUndefined(uid)).toBe("test-uid-1@example.com");
	});

	it("returns None for a VCALENDAR with no child components", async () => {
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		expect(Option.isNone(extractUid(doc))).toBe(true);
	});

	it("returns None when UID property is missing from the child component", async () => {
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"DTSTAMP:20060717T210714Z",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		expect(Option.isNone(extractUid(doc))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Temporal integration sanity check
// ---------------------------------------------------------------------------

describe("ICalendarCodec Temporal integration", () => {
	it("DTSTAMP with Z suffix decodes to UTC ZonedDateTime", async () => {
		const doc = await run(minimalVevent);
		const vevent = doc.root.components[0];
		const dtstamp = vevent?.properties.find((p) => p.name === "DTSTAMP");
		expect(dtstamp?.value.type).toBe("DATE_TIME");
		if (dtstamp?.value.type === "DATE_TIME") {
			expect(dtstamp.value.value.timeZoneId).toBe("UTC");
		}
	});

	it("encodes DATE back to YYYYMMDD format with VALUE=DATE parameter preserved", async () => {
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:encode-date@example.com",
			"DTSTAMP:20060717T210714Z",
			"DTSTART;VALUE=DATE:20060102",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		const out = await enc(doc);
		expect(out).toContain("DTSTART;VALUE=DATE:20060102");
	});

	it("encodes UTC ZonedDateTime with trailing Z", async () => {
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:encode-utc@example.com",
			"DTSTAMP:20060717T210714Z",
			"DTSTART:20060717T210714Z",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		const out = await enc(doc);
		expect(out).toContain("DTSTART:20060717T210714Z");
	});

	it("ICalendarCodec schema round-trips a Temporal.PlainDate without loss", async () => {
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:plain-date@example.com",
			"DTSTAMP:20060717T210714Z",
			"DTSTART;VALUE=DATE:20060102",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc1 = await run(text);
		const encoded = await enc(doc1);
		const doc2 = await run(encoded);
		const dtstart1 = doc1.root.components[0]?.properties.find((p) => p.name === "DTSTART");
		const dtstart2 = doc2.root.components[0]?.properties.find((p) => p.name === "DTSTART");
		expect(dtstart1?.value).toEqual(dtstart2?.value);
		if (dtstart2?.value.type === "DATE") {
			expect(Temporal.PlainDate.compare(
				dtstart2.value.value,
				Temporal.PlainDate.from({ year: 2006, month: 1, day: 2 }),
			)).toBe(0);
		}
	});
});
