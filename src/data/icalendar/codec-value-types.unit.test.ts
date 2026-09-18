import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import type { IrComponent } from "#src/data/ir.ts";
import {
	decodeICalendar,
	encodeICalComponent,
	encodeICalendar,
} from "./codec.ts";

// Value-type resolution: what each property decodes to by default, and how an
// explicit VALUE= parameter overrides that. Split from codec.unit.test.ts,
// which covers the decode/encode/round-trip surface.

const ical = (...lines: Array<string>) => `${lines.join("\r\n")}\r\n`;

const run = (text: string) => Effect.runPromise(decodeICalendar(text));
const enc = (doc: Parameters<typeof encodeICalendar>[0]) =>
	Effect.runPromise(encodeICalendar(doc));

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
			const first = prop.value.value[0];
			expect(
				first && "timeZoneId" in first ? first.timeZoneId : undefined,
			).toBe("UTC");
		}
	});

	it("RDATE with floating datetimes decodes as floating list items", async () => {
		// Floating local times — valid RFC 5545 Form 1 (no "Z", no TZID). Required
		// for RDATE inside a VTIMEZONE observance (RFC 5545 §3.6.5).
		const doc = await run(wrap("RDATE:20231105T010000,20241103T010000"));
		const prop = doc.root.components[0]?.properties.find(
			(p) => p.name === "RDATE",
		);
		expect(prop?.value.type).toBe("DATE_TIME_LIST");
		if (prop?.value.type === "DATE_TIME_LIST") {
			expect(prop.value.value).toHaveLength(2);
			// Floating items carry no zone (PlainDateTime, not ZonedDateTime).
			expect(prop.value.value.every((d) => !("timeZoneId" in d))).toBe(true);
			expect(prop.value.value[0]?.toString()).toBe("2023-11-05T01:00:00");
		}
	});

	it("round-trips a floating RDATE list unchanged", async () => {
		const input = wrap("RDATE:20231105T010000,20241103T010000");
		const doc = await run(input);
		const encoded = await enc(doc);
		expect(encoded).toContain("RDATE:20231105T010000,20241103T010000");
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
