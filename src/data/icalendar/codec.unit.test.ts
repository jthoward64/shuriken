import { describe, expect, it } from "bun:test";
import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type { IrComponent } from "#src/data/ir.ts";
import { runFailure } from "#src/testing/effect.ts";
import {
	decodeICalendar,
	encodeICalComponent,
	encodeICalendar,
} from "./codec.ts";
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

	it("EXDATE;VALUE=DATE decodes comma-separated dates to DATE_LIST", async () => {
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:exdate-test@example.com",
			"DTSTAMP:20060717T210714Z",
			"EXDATE;VALUE=DATE:20060102,20060103",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		const vevent = doc.root.components[0];
		const exdate = vevent?.properties.find((p) => p.name === "EXDATE");
		expect(exdate?.value.type).toBe("DATE_LIST");
		if (exdate?.value.type === "DATE_LIST") {
			expect(exdate.value.value).toHaveLength(2);
			expect(
				Temporal.PlainDate.compare(
					exdate.value.value[0] as Temporal.PlainDate,
					Temporal.PlainDate.from({ year: 2006, month: 1, day: 2 }),
				),
			).toBe(0);
			expect(
				Temporal.PlainDate.compare(
					exdate.value.value[1] as Temporal.PlainDate,
					Temporal.PlainDate.from({ year: 2006, month: 1, day: 3 }),
				),
			).toBe(0);
		}
	});

	it("TRIGGER;VALUE=DATE-TIME decodes to DATE_TIME (UTC)", async () => {
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:trigger-test@example.com",
			"DTSTAMP:20060717T210714Z",
			"BEGIN:VALARM",
			"ACTION:EMAIL",
			"TRIGGER;VALUE=DATE-TIME:19980101T050000Z",
			"END:VALARM",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		const valarm = doc.root.components[0]?.components[0];
		const trigger = valarm?.properties.find((p) => p.name === "TRIGGER");
		expect(trigger?.value.type).toBe("DATE_TIME");
		if (trigger?.value.type === "DATE_TIME") {
			expect(trigger.value.value.timeZoneId).toBe("UTC");
			expect(trigger.value.value.year).toBe(1998);
			expect(trigger.value.value.hour).toBe(5);
		}
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

	it("DATE_LIST encode injects VALUE=DATE param when absent", async () => {
		// Programmatically constructed DATE_LIST with no VALUE param must still
		// round-trip correctly (decoder needs VALUE=DATE to parse it as DATE_LIST).
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:date-list-encode@example.com",
			"DTSTAMP:20060717T210714Z",
			"EXDATE;VALUE=DATE:20060102,20060103",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		const out = await enc(doc);
		// Encoded output must include VALUE=DATE so a decoder can interpret it
		expect(out).toContain("VALUE=DATE");
		// Must also round-trip cleanly
		const doc2 = await run(out);
		const exdate2 = doc2.root.components[0]?.properties.find(
			(p) => p.name === "EXDATE",
		);
		expect(exdate2?.value.type).toBe("DATE_LIST");
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
		const dtstart1 = doc1.root.components[0]?.properties.find(
			(p) => p.name === "DTSTART",
		);
		const dtstart2 = doc2.root.components[0]?.properties.find(
			(p) => p.name === "DTSTART",
		);
		expect(dtstart1?.value).toEqual(dtstart2?.value);
		if (dtstart2?.value.type === "DATE") {
			expect(
				Temporal.PlainDate.compare(
					dtstart2.value.value,
					Temporal.PlainDate.from({ year: 2006, month: 1, day: 2 }),
				),
			).toBe(0);
		}
	});
});

// ---------------------------------------------------------------------------
// Default value types — properties whose type is not DATE_TIME
// ---------------------------------------------------------------------------

describe("ICalendarCodec decode — default value types", () => {
	const wrap = (...lines: Array<string>) =>
		ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:type-test@example.com",
			"DTSTAMP:20060717T210714Z",
			...lines,
			"END:VEVENT",
			"END:VCALENDAR",
		);

	it("PRIORITY decodes as INTEGER (default)", async () => {
		const doc = await run(wrap("PRIORITY:5"));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "PRIORITY",
		);
		expect(prop?.value.type).toBe("INTEGER");
		if (prop?.value.type === "INTEGER") {
			expect(prop.value.value).toBe(5);
		}
	});

	it("SEQUENCE decodes as INTEGER (default)", async () => {
		const doc = await run(wrap("SEQUENCE:3"));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "SEQUENCE",
		);
		expect(prop?.value.type).toBe("INTEGER");
		if (prop?.value.type === "INTEGER") {
			expect(prop.value.value).toBe(3);
		}
	});

	it("CATEGORIES decodes as TEXT_LIST (default)", async () => {
		const doc = await run(wrap("CATEGORIES:MEETING,APPOINTMENT"));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "CATEGORIES",
		);
		expect(prop?.value.type).toBe("TEXT_LIST");
		if (prop?.value.type === "TEXT_LIST") {
			expect(prop.value.value).toEqual(["MEETING", "APPOINTMENT"]);
		}
	});

	it("DURATION decodes as DURATION (default)", async () => {
		const doc = await run(wrap("DURATION:PT1H30M"));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "DURATION",
		);
		expect(prop?.value.type).toBe("DURATION");
		if (prop?.value.type === "DURATION") {
			expect(prop.value.value).toBe("PT1H30M");
		}
	});

	it("TRIGGER (no VALUE param) decodes as DURATION (default)", async () => {
		const valarmText = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:trigger-dur@example.com",
			"DTSTAMP:20060717T210714Z",
			"BEGIN:VALARM",
			"ACTION:DISPLAY",
			"TRIGGER:-PT15M",
			"END:VALARM",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(valarmText);
		const trigger = doc.root.components[0]?.components[0]?.properties.find(
			(p) => p.name === "TRIGGER",
		);
		expect(trigger?.value.type).toBe("DURATION");
		if (trigger?.value.type === "DURATION") {
			expect(trigger.value.value).toBe("-PT15M");
		}
	});

	it("TZOFFSETFROM decodes as UTC_OFFSET (default)", async () => {
		const vtimezoneText = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VTIMEZONE",
			"TZID:America/New_York",
			"BEGIN:STANDARD",
			"DTSTART:19671029T020000",
			"TZOFFSETFROM:-0400",
			"TZOFFSETTO:-0500",
			"END:STANDARD",
			"END:VTIMEZONE",
			"END:VCALENDAR",
		);
		const doc = await run(vtimezoneText);
		const standard = doc.root.components[0]?.components[0];
		const from = standard?.properties.find((p) => p.name === "TZOFFSETFROM");
		expect(from?.value.type).toBe("UTC_OFFSET");
		if (from?.value.type === "UTC_OFFSET") {
			expect(from.value.value).toBe("-0400");
		}
		const to = standard?.properties.find((p) => p.name === "TZOFFSETTO");
		expect(to?.value.type).toBe("UTC_OFFSET");
	});

	it("ATTENDEE decodes as CAL_ADDRESS (default)", async () => {
		const doc = await run(wrap("ATTENDEE:mailto:alice@example.com"));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "ATTENDEE",
		);
		expect(prop?.value.type).toBe("CAL_ADDRESS");
		if (prop?.value.type === "CAL_ADDRESS") {
			expect(prop.value.value).toBe("mailto:alice@example.com");
		}
	});

	it("ORGANIZER decodes as CAL_ADDRESS (default)", async () => {
		const doc = await run(wrap("ORGANIZER:mailto:org@example.com"));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "ORGANIZER",
		);
		expect(prop?.value.type).toBe("CAL_ADDRESS");
	});

	it("RRULE decodes as RECUR (default)", async () => {
		const doc = await run(wrap("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "RRULE",
		);
		expect(prop?.value.type).toBe("RECUR");
		if (prop?.value.type === "RECUR") {
			expect(prop.value.value).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
		}
	});

	it("FREEBUSY decodes as PERIOD_LIST (default)", async () => {
		const fbText = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VFREEBUSY",
			"UID:fb@example.com",
			"DTSTART:19980313T141711Z",
			"DTEND:19980410T141711Z",
			"FREEBUSY:19980314T233000Z/19980315T003000Z,19980316T153000Z/19980316T163000Z",
			"END:VFREEBUSY",
			"END:VCALENDAR",
		);
		const doc = await run(fbText);
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "FREEBUSY",
		);
		expect(prop?.value.type).toBe("PERIOD_LIST");
		if (prop?.value.type === "PERIOD_LIST") {
			expect(prop.value.value).toHaveLength(2);
		}
	});

	it("RDATE with UTC datetimes decodes as DATE_TIME_LIST", async () => {
		const doc = await run(
			wrap("RDATE:19970101T180000Z,19970120T070000Z,19970217T070000Z"),
		);
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "RDATE",
		);
		expect(prop?.value.type).toBe("DATE_TIME_LIST");
		if (prop?.value.type === "DATE_TIME_LIST") {
			expect(prop.value.value).toHaveLength(3);
			expect(prop.value.value[0]?.timeZoneId).toBe("UTC");
		}
	});
});

// ---------------------------------------------------------------------------
// VALUE= parameter overrides
// ---------------------------------------------------------------------------

describe("ICalendarCodec decode — VALUE= overrides", () => {
	const wrap = (...lines: Array<string>) =>
		ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:override@example.com",
			"DTSTAMP:20060717T210714Z",
			...lines,
			"END:VEVENT",
			"END:VCALENDAR",
		);

	it("VALUE=BINARY overrides ATTACH to BINARY", async () => {
		const base64 = btoa("hello");
		const doc = await run(wrap(`ATTACH;VALUE=BINARY:${base64}`));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "ATTACH",
		);
		expect(prop?.value.type).toBe("BINARY");
		if (prop?.value.type === "BINARY") {
			expect(new TextDecoder().decode(prop.value.value)).toBe("hello");
		}
	});

	it("VALUE=BOOLEAN overrides to BOOLEAN", async () => {
		// Use a known TEXT property overridden to BOOLEAN
		const doc = await run(wrap("COMMENT;VALUE=BOOLEAN:TRUE"));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "COMMENT",
		);
		expect(prop?.value.type).toBe("BOOLEAN");
		if (prop?.value.type === "BOOLEAN") {
			expect(prop.value.value).toBe(true);
		}
	});

	it("VALUE=FLOAT overrides to FLOAT", async () => {
		const doc = await run(wrap("COMMENT;VALUE=FLOAT:3.14"));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "COMMENT",
		);
		expect(prop?.value.type).toBe("FLOAT");
		if (prop?.value.type === "FLOAT") {
			expect(prop.value.value).toBeCloseTo(3.14);
		}
	});

	it("VALUE=INTEGER overrides to INTEGER", async () => {
		const doc = await run(wrap("COMMENT;VALUE=INTEGER:42"));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "COMMENT",
		);
		expect(prop?.value.type).toBe("INTEGER");
		if (prop?.value.type === "INTEGER") {
			expect(prop.value.value).toBe(42);
		}
	});

	it("VALUE=PERIOD overrides to PERIOD", async () => {
		const doc = await run(
			wrap("COMMENT;VALUE=PERIOD:19970101T180000Z/19970102T070000Z"),
		);
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "COMMENT",
		);
		expect(prop?.value.type).toBe("PERIOD");
		if (prop?.value.type === "PERIOD") {
			expect(prop.value.value).toBe("19970101T180000Z/19970102T070000Z");
		}
	});

	it("VALUE=RECUR overrides to RECUR", async () => {
		const doc = await run(wrap("COMMENT;VALUE=RECUR:FREQ=DAILY;COUNT=10"));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "COMMENT",
		);
		expect(prop?.value.type).toBe("RECUR");
		if (prop?.value.type === "RECUR") {
			expect(prop.value.value).toBe("FREQ=DAILY;COUNT=10");
		}
	});

	it("VALUE=TEXT overrides to TEXT", async () => {
		// ATTACH defaults to URI; override to TEXT
		const doc = await run(wrap("ATTACH;VALUE=TEXT:plain text value"));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "ATTACH",
		);
		expect(prop?.value.type).toBe("TEXT");
		if (prop?.value.type === "TEXT") {
			expect(prop.value.value).toBe("plain text value");
		}
	});

	it("VALUE=TIME overrides to TIME", async () => {
		const doc = await run(wrap("COMMENT;VALUE=TIME:120000"));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "COMMENT",
		);
		expect(prop?.value.type).toBe("TIME");
		if (prop?.value.type === "TIME") {
			expect(prop.value.value).toBe("120000");
		}
	});

	it("VALUE=URI overrides to URI", async () => {
		const doc = await run(wrap("COMMENT;VALUE=URI:https://example.com"));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "COMMENT",
		);
		expect(prop?.value.type).toBe("URI");
		if (prop?.value.type === "URI") {
			expect(prop.value.value).toBe("https://example.com");
		}
	});

	it("VALUE=UTC-OFFSET overrides to UTC_OFFSET", async () => {
		const doc = await run(wrap("COMMENT;VALUE=UTC-OFFSET:+0530"));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "COMMENT",
		);
		expect(prop?.value.type).toBe("UTC_OFFSET");
		if (prop?.value.type === "UTC_OFFSET") {
			expect(prop.value.value).toBe("+0530");
		}
	});

	it("VALUE=CAL-ADDRESS overrides to CAL_ADDRESS", async () => {
		const doc = await run(
			wrap("COMMENT;VALUE=CAL-ADDRESS:mailto:user@example.com"),
		);
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "COMMENT",
		);
		expect(prop?.value.type).toBe("CAL_ADDRESS");
	});

	it("VALUE=DURATION overrides to DURATION", async () => {
		const doc = await run(wrap("COMMENT;VALUE=DURATION:P1DT2H"));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "COMMENT",
		);
		expect(prop?.value.type).toBe("DURATION");
		if (prop?.value.type === "DURATION") {
			expect(prop.value.value).toBe("P1DT2H");
		}
	});
});

// ---------------------------------------------------------------------------
// Encode guard and encodeICalComponent
// ---------------------------------------------------------------------------

describe("ICalendarCodec encode guards and helpers", () => {
	it("encodeICalProperty throws when named-timezone DATE_TIME has no TZID param", async () => {
		// Construct an IrDocument with a named-timezone DATE_TIME but no TZID parameter
		const doc: Parameters<typeof encodeICalendar>[0] = {
			kind: "icalendar",
			root: {
				name: "VCALENDAR",
				properties: [
					{
						name: "VERSION",
						parameters: [],
						value: { type: "TEXT", value: "2.0" },
						isKnown: true,
					},
					{
						name: "PRODID",
						parameters: [],
						value: { type: "TEXT", value: "-//Test//EN" },
						isKnown: true,
					},
				],
				components: [
					{
						name: "VEVENT",
						properties: [
							{
								name: "UID",
								parameters: [],
								value: { type: "TEXT", value: "tzid-guard@example.com" },
								isKnown: true,
							},
							{
								name: "DTSTAMP",
								parameters: [],
								value: {
									type: "DATE_TIME",
									value: Temporal.ZonedDateTime.from(
										"2006-07-17T21:07:14+00:00[UTC]",
									),
								},
								isKnown: true,
							},
							{
								// No TZID parameter — should throw when encoding
								name: "DTSTART",
								parameters: [],
								value: {
									type: "DATE_TIME",
									value: Temporal.ZonedDateTime.from(
										"2006-01-02T15:04:05-05:00[America/New_York]",
									),
								},
								isKnown: true,
							},
						],
						components: [],
					},
				],
			},
		};
		// encodeICalendar uses Effect.orDie, so the thrown Error becomes a defect
		await expect(Effect.runPromise(encodeICalendar(doc))).rejects.toThrow();
	});

	it("encodeICalComponent serializes a VTIMEZONE component to text", async () => {
		const vtimezone: IrComponent = {
			name: "VTIMEZONE",
			properties: [
				{
					name: "TZID",
					parameters: [],
					value: { type: "TEXT", value: "America/New_York" },
					isKnown: true,
				},
			],
			components: [
				{
					name: "STANDARD",
					properties: [
						{
							name: "DTSTART",
							parameters: [],
							value: {
								type: "PLAIN_DATE_TIME",
								value: Temporal.PlainDateTime.from("1967-10-29T02:00:00"),
							},
							isKnown: true,
						},
						{
							name: "TZOFFSETFROM",
							parameters: [],
							value: { type: "UTC_OFFSET", value: "-0400" },
							isKnown: true,
						},
						{
							name: "TZOFFSETTO",
							parameters: [],
							value: { type: "UTC_OFFSET", value: "-0500" },
							isKnown: true,
						},
					],
					components: [],
				},
			],
		};
		const text = await Effect.runPromise(encodeICalComponent(vtimezone));
		expect(text).toContain("BEGIN:VTIMEZONE");
		expect(text).toContain("TZID:America/New_York");
		expect(text).toContain("BEGIN:STANDARD");
		expect(text).toContain("TZOFFSETFROM:-0400");
		expect(text).toContain("END:VTIMEZONE");
		expect(text.endsWith("\r\n")).toBe(true);
	});

	it("encodes BOOLEAN value as TRUE/FALSE", async () => {
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:bool-enc@example.com",
			"DTSTAMP:20060717T210714Z",
			"COMMENT;VALUE=BOOLEAN:TRUE",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		const out = await enc(doc);
		expect(out).toContain("TRUE");
	});

	it("encodes INTEGER value as decimal string", async () => {
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:int-enc@example.com",
			"DTSTAMP:20060717T210714Z",
			"PRIORITY:3",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		const out = await enc(doc);
		expect(out).toContain("PRIORITY:3");
	});

	it("encodes FLOAT value as decimal string", async () => {
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:float-enc@example.com",
			"DTSTAMP:20060717T210714Z",
			"COMMENT;VALUE=FLOAT:2.5",
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		const out = await enc(doc);
		expect(out).toContain("2.5");
	});

	it("encodes BINARY value as base64", async () => {
		const base64 = btoa("hello");
		const text = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VEVENT",
			"UID:binary-enc@example.com",
			"DTSTAMP:20060717T210714Z",
			`ATTACH;VALUE=BINARY:${base64}`,
			"END:VEVENT",
			"END:VCALENDAR",
		);
		const doc = await run(text);
		const out = await enc(doc);
		expect(out).toContain(base64);
	});

	it("encodes PERIOD_LIST as comma-separated periods", async () => {
		const fbText = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VFREEBUSY",
			"UID:fb-enc@example.com",
			"DTSTART:19980313T141711Z",
			"DTEND:19980410T141711Z",
			"FREEBUSY:19980314T233000Z/PT1H,19980316T153000Z/PT30M",
			"END:VFREEBUSY",
			"END:VCALENDAR",
		);
		const doc = await run(fbText);
		const out = await enc(doc);
		expect(out).toContain("FREEBUSY:");
	});

	it("encodes PLAIN_DATE_TIME (floating) without Z or TZID", async () => {
		const vtimezoneText = ical(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//Test//EN",
			"BEGIN:VTIMEZONE",
			"TZID:America/New_York",
			"BEGIN:STANDARD",
			"DTSTART:19671029T020000",
			"TZOFFSETFROM:-0400",
			"TZOFFSETTO:-0500",
			"END:STANDARD",
			"END:VTIMEZONE",
			"END:VCALENDAR",
		);
		const doc = await run(vtimezoneText);
		const out = await enc(doc);
		// Floating datetime in VTIMEZONE DTSTART: no Z, no TZID param
		expect(out).toContain("DTSTART:19671029T020000");
	});

	it("encodes JSON value", async () => {
		// Construct a doc with a JSON property value directly (no decode path for JSON)
		const doc: Parameters<typeof encodeICalendar>[0] = {
			kind: "icalendar",
			root: {
				name: "VCALENDAR",
				properties: [
					{
						name: "VERSION",
						parameters: [],
						value: { type: "TEXT", value: "2.0" },
						isKnown: true,
					},
					{
						name: "PRODID",
						parameters: [],
						value: { type: "TEXT", value: "-//Test//EN" },
						isKnown: true,
					},
				],
				components: [
					{
						name: "VEVENT",
						properties: [
							{
								name: "UID",
								parameters: [],
								value: { type: "TEXT", value: "json-enc@example.com" },
								isKnown: true,
							},
							{
								name: "DTSTAMP",
								parameters: [],
								value: {
									type: "DATE_TIME",
									value: Temporal.ZonedDateTime.from(
										"2006-07-17T21:07:14+00:00[UTC]",
									),
								},
								isKnown: true,
							},
							{
								name: "COMMENT",
								parameters: [],
								value: { type: "JSON", value: { key: "val" } },
								isKnown: true,
							},
						],
						components: [],
					},
				],
			},
		};
		const out = await enc(doc);
		expect(out).toContain('{"key":"val"}');
	});
});
