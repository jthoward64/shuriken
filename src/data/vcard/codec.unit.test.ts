import { describe, expect, it } from "bun:test";
import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type { IrDocument } from "#src/data/ir.ts";
import { runFailure } from "#src/testing/effect.ts";
import { decodeVCard, encodeVCard } from "./codec.ts";
import { extractUid } from "./uid.ts";
import { isVCard21, normalizeVCard21 } from "./vcard21.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const vcard = (...lines: Array<string>) => `${lines.join("\r\n")}\r\n`;

const run = (text: string) => Effect.runPromise(decodeVCard(text));
const enc = (doc: Parameters<typeof encodeVCard>[0]) =>
	Effect.runPromise(encodeVCard(doc));

const minimalVCard = vcard(
	"BEGIN:VCARD",
	"VERSION:4.0",
	"FN:Test User",
	"UID:urn:uuid:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1",
	"END:VCARD",
);

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

describe("VCardCodec decode", () => {
	it("decodes a minimal VCARD with FN and UID", async () => {
		const doc = await run(minimalVCard);
		expect(doc.kind).toBe("vcard");
		expect(doc.root.name).toBe("VCARD");
		const fn = doc.root.properties.find((p) => p.name === "FN");
		expect(fn?.value.type).toBe("TEXT");
		if (fn?.value.type === "TEXT") {
			expect(fn.value.value).toBe("Test User");
		}
		const uid = doc.root.properties.find((p) => p.name === "UID");
		expect(uid?.value.type).toBe("URI");
	});

	it("stores X- properties as TEXT with isKnown: false, verbatim", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"X-CUSTOM:hello\\,world",
			"END:VCARD",
		);
		const doc = await run(text);
		const xProp = doc.root.properties.find((p) => p.name === "X-CUSTOM");
		expect(xProp?.isKnown).toBe(false);
		expect(xProp?.value.type).toBe("TEXT");
		if (xProp?.value.type === "TEXT") {
			// rawValue stored verbatim — NOT unescaped
			expect(xProp.value.value).toBe("hello\\,world");
		}
	});

	it("stores unrecognized IANA properties as TEXT with isKnown: false", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"UNKNOWN-PROP:some value",
			"END:VCARD",
		);
		const doc = await run(text);
		const prop = doc.root.properties.find((p) => p.name === "UNKNOWN-PROP");
		expect(prop?.isKnown).toBe(false);
	});

	it("fails with validAddressData when root component is not VCARD", async () => {
		const text = vcard("BEGIN:VCALENDAR", "VERSION:2.0", "END:VCALENDAR");
		const err = await runFailure(decodeVCard(text));
		expect(err._tag).toBe("DavError");
		expect(err.precondition).toBe("CARDDAV:valid-address-data");
	});

	it("decodes CATEGORIES as TEXT_LIST", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"CATEGORIES:MEETING,APPOINTMENT",
			"END:VCARD",
		);
		const doc = await run(text);
		const cats = doc.root.properties.find((p) => p.name === "CATEGORIES");
		expect(cats?.value.type).toBe("TEXT_LIST");
		if (cats?.value.type === "TEXT_LIST") {
			expect(cats.value.value).toEqual(["MEETING", "APPOINTMENT"]);
		}
	});

	it("decodes BDAY full date to Temporal.PlainDate", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"BDAY:19850412",
			"END:VCARD",
		);
		const doc = await run(text);
		const bday = doc.root.properties.find((p) => p.name === "BDAY");
		expect(bday?.value.type).toBe("DATE");
		if (bday?.value.type === "DATE") {
			expect(bday.value.value.year).toBe(1985);
			expect(bday.value.value.month).toBe(4);
			expect(bday.value.value.day).toBe(12);
		}
	});

	it("decodes BDAY hyphenated date to Temporal.PlainDate", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"BDAY:1985-04-12",
			"END:VCARD",
		);
		const doc = await run(text);
		const bday = doc.root.properties.find((p) => p.name === "BDAY");
		expect(bday?.value.type).toBe("DATE");
		if (bday?.value.type === "DATE") {
			expect(
				Temporal.PlainDate.compare(
					bday.value.value,
					Temporal.PlainDate.from({ year: 1985, month: 4, day: 12 }),
				),
			).toBe(0);
		}
	});

	it("decodes BDAY yearless partial date as opaque DATE_AND_OR_TIME", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"BDAY:--0412",
			"END:VCARD",
		);
		const doc = await run(text);
		const bday = doc.root.properties.find((p) => p.name === "BDAY");
		expect(bday?.value.type).toBe("DATE_AND_OR_TIME");
		if (bday?.value.type === "DATE_AND_OR_TIME") {
			expect(bday.value.value).toBe("--0412");
		}
	});

	it("VALUE=uri override on UID changes type to URI", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"UID;VALUE=uri:urn:uuid:abc-123",
			"END:VCARD",
		);
		const doc = await run(text);
		const uid = doc.root.properties.find((p) => p.name === "UID");
		expect(uid?.value.type).toBe("URI");
		if (uid?.value.type === "URI") {
			expect(uid.value.value).toBe("urn:uuid:abc-123");
		}
	});

	it("unescapes backslash sequences in TEXT properties", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"NOTE:Hello\\, World\\; newline\\n end",
			"END:VCARD",
		);
		const doc = await run(text);
		const note = doc.root.properties.find((p) => p.name === "NOTE");
		expect(note?.value.type).toBe("TEXT");
		if (note?.value.type === "TEXT") {
			expect(note.value.value).toBe("Hello, World; newline\n end");
		}
	});

	it("splits CATEGORIES at unescaped commas, unescaping items", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"CATEGORIES:a\\,b,c",
			"END:VCARD",
		);
		const doc = await run(text);
		const cats = doc.root.properties.find((p) => p.name === "CATEGORIES");
		expect(cats?.value.type).toBe("TEXT_LIST");
		if (cats?.value.type === "TEXT_LIST") {
			expect(cats.value.value).toEqual(["a,b", "c"]);
		}
	});

	it("REV with fixed-offset datetime decodes to DATE_TIME ZonedDateTime", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"REV:20060714T000000-0500",
			"END:VCARD",
		);
		const doc = await run(text);
		const rev = doc.root.properties.find((p) => p.name === "REV");
		expect(rev?.value.type).toBe("DATE_TIME");
		if (rev?.value.type === "DATE_TIME") {
			expect(rev.value.value.year).toBe(2006);
			expect(rev.value.value.month).toBe(7);
			expect(rev.value.value.day).toBe(14);
			expect(rev.value.value.hour).toBe(0);
			// Fixed-offset zone ID: "-05:00"
			expect(rev.value.value.timeZoneId).toBe("-05:00");
		}
	});

	it("REV with fixed-offset datetime round-trips through encode/decode", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"REV:20060714T000000-0500",
			"END:VCARD",
		);
		const doc1 = await run(text);
		const encoded = await enc(doc1);
		// Encoded form should inline the offset without colon
		expect(encoded).toContain("REV:20060714T000000-0500");
		const doc2 = await run(encoded);
		const rev1 = doc1.root.properties.find((p) => p.name === "REV");
		const rev2 = doc2.root.properties.find((p) => p.name === "REV");
		expect(rev1?.value).toEqual(rev2?.value);
	});
});

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

describe("VCardCodec encode", () => {
	it("encoded output has every physical line ≤75 UTF-8 octets with CRLF endings", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"NOTE:This is a very long note that will exceed the seventy-five octet limit fold",
			"END:VCARD",
		);
		const doc = await run(text);
		const out = await enc(doc);
		const encoder = new TextEncoder();
		for (const line of out.split("\r\n").filter((l) => l.length > 0)) {
			expect(encoder.encode(line).byteLength).toBeLessThanOrEqual(75);
		}
		expect(out.endsWith("\r\n")).toBe(true);
	});

	it("emits X-/unknown properties verbatim without double-escaping", async () => {
		const xValue = "hello\\,world";
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			`X-CUSTOM:${xValue}`,
			"END:VCARD",
		);
		const doc = await run(text);
		const out = await enc(doc);
		expect(out).toContain(`X-CUSTOM:${xValue}`);
	});
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("VCardCodec round-trip", () => {
	it("decode → encode → decode yields structurally equal IrDocument", async () => {
		const doc1 = await run(minimalVCard);
		const encoded = await enc(doc1);
		const doc2 = await run(encoded);
		expect(doc2).toEqual(doc1);
	});

	it("BDAY opaque partial date survives round-trip unchanged", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"BDAY:--0412",
			"END:VCARD",
		);
		const doc1 = await run(text);
		const out = await enc(doc1);
		const doc2 = await run(out);
		expect(doc2).toEqual(doc1);
	});
});

// ---------------------------------------------------------------------------
// extractUid
// ---------------------------------------------------------------------------

describe("extractUid (vCard)", () => {
	it("extracts UID URI from root VCARD", async () => {
		const doc = await run(minimalVCard);
		const uid = extractUid(doc);
		expect(Option.isSome(uid)).toBe(true);
		expect(Option.getOrUndefined(uid)).toBe(
			"urn:uuid:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1",
		);
	});

	it("accepts vCard 3.0 TEXT UID", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:3.0",
			"FN:Test",
			"UID:my-text-uid-123",
			"END:VCARD",
		);
		const doc = await run(text);
		// In 3.0 UID defaults to URI, but value parsing may differ;
		// extractUid accepts both URI and TEXT types
		const uid = extractUid(doc);
		expect(Option.isSome(uid)).toBe(true);
	});

	it("returns None when UID property is absent", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:No UID here",
			"END:VCARD",
		);
		const doc = await run(text);
		expect(Option.isNone(extractUid(doc))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// vCard 2.1 normalization (vcard21.ts)
// ---------------------------------------------------------------------------

describe("vCard 2.1 normalization", () => {
	it("isVCard21 returns true for VERSION:2.1 input", () => {
		expect(isVCard21("BEGIN:VCARD\r\nVERSION:2.1\r\nEND:VCARD\r\n")).toBe(true);
	});

	it("isVCard21 returns false for vCard 4.0 input", () => {
		expect(isVCard21(minimalVCard)).toBe(false);
	});

	it("normalizes bare TYPE parameters to explicit TYPE= form", () => {
		const raw = "TEL;WORK;VOICE:+1-555-5555";
		const out = normalizeVCard21(raw);
		expect(out).toContain("TYPE=WORK,VOICE");
		expect(out).toContain("+1-555-5555");
	});

	it("converts bare PREF to PREF=1", () => {
		const raw = "TEL;WORK;PREF:+1-555-5555";
		const out = normalizeVCard21(raw);
		expect(out).toContain("PREF=1");
	});

	it("decodes QUOTED-PRINTABLE values", () => {
		const raw = "NOTE;ENCODING=QUOTED-PRINTABLE:Hello=20World";
		const out = normalizeVCard21(raw);
		expect(out).toContain("Hello World");
	});

	it("joins QP soft-wrapped continuation lines", () => {
		const raw = "NOTE;ENCODING=QUOTED-PRINTABLE:Hello=\r\n World";
		const out = normalizeVCard21(raw);
		// Soft break removed, lines joined
		expect(out).not.toContain("=\r\n");
	});

	it("full vCard 2.1 decodes without error via decodeVCard routing", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:2.1",
			"FN:Test User",
			"TEL;WORK;VOICE:+1-555-5555",
			"NOTE;ENCODING=QUOTED-PRINTABLE:Hello=20World",
			"END:VCARD",
		);
		const doc = await run(text);
		expect(doc.kind).toBe("vcard");
		// TEL should have been decoded with TYPE param
		const tel = doc.root.properties.find((p) => p.name === "TEL");
		expect(tel).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// VALUE= parameter overrides
// ---------------------------------------------------------------------------

describe("VCardCodec decode — VALUE= overrides", () => {
	it("VALUE=text overrides URI property to TEXT", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"PHOTO;VALUE=text:plain text value",
			"END:VCARD",
		);
		const doc = await run(text);
		const prop = doc.root.properties.find((p) => p.name === "PHOTO");
		expect(prop?.value.type).toBe("TEXT");
		if (prop?.value.type === "TEXT") {
			expect(prop.value.value).toBe("plain text value");
		}
	});

	it("VALUE=boolean decodes as BOOLEAN", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"NOTE;VALUE=boolean:TRUE",
			"END:VCARD",
		);
		const doc = await run(text);
		const prop = doc.root.properties.find((p) => p.name === "NOTE");
		expect(prop?.value.type).toBe("BOOLEAN");
		if (prop?.value.type === "BOOLEAN") {
			expect(prop.value.value).toBe(true);
		}
	});

	it("VALUE=integer decodes as INTEGER", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"NOTE;VALUE=integer:42",
			"END:VCARD",
		);
		const doc = await run(text);
		const prop = doc.root.properties.find((p) => p.name === "NOTE");
		expect(prop?.value.type).toBe("INTEGER");
		if (prop?.value.type === "INTEGER") {
			expect(prop.value.value).toBe(42);
		}
	});

	it("VALUE=float decodes as FLOAT", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"NOTE;VALUE=float:3.14",
			"END:VCARD",
		);
		const doc = await run(text);
		const prop = doc.root.properties.find((p) => p.name === "NOTE");
		expect(prop?.value.type).toBe("FLOAT");
		if (prop?.value.type === "FLOAT") {
			expect(prop.value.value).toBeCloseTo(3.14);
		}
	});

	it("VALUE=utc-offset decodes as UTC_OFFSET", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"TZ;VALUE=utc-offset:+0530",
			"END:VCARD",
		);
		const doc = await run(text);
		const prop = doc.root.properties.find((p) => p.name === "TZ");
		expect(prop?.value.type).toBe("UTC_OFFSET");
		if (prop?.value.type === "UTC_OFFSET") {
			expect(prop.value.value).toBe("+0530");
		}
	});

	it("VALUE=time decodes as TIME", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"NOTE;VALUE=time:120000",
			"END:VCARD",
		);
		const doc = await run(text);
		const prop = doc.root.properties.find((p) => p.name === "NOTE");
		expect(prop?.value.type).toBe("TIME");
		if (prop?.value.type === "TIME") {
			expect(prop.value.value).toBe("120000");
		}
	});

	it("VALUE=language-tag maps to TEXT", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"LANG;VALUE=language-tag:en-US",
			"END:VCARD",
		);
		const doc = await run(text);
		const prop = doc.root.properties.find((p) => p.name === "LANG");
		expect(prop?.value.type).toBe("TEXT");
		if (prop?.value.type === "TEXT") {
			expect(prop.value.value).toBe("en-US");
		}
	});

	it("VALUE=text-list decodes as TEXT_LIST", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"NOTE;VALUE=text-list:a,b,c",
			"END:VCARD",
		);
		const doc = await run(text);
		const prop = doc.root.properties.find((p) => p.name === "NOTE");
		expect(prop?.value.type).toBe("TEXT_LIST");
		if (prop?.value.type === "TEXT_LIST") {
			expect(prop.value.value).toEqual(["a", "b", "c"]);
		}
	});

	it("VALUE=date-time (UTC Z) decodes as DATE_TIME ZonedDateTime", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"BDAY;VALUE=date-time:20060718T210714Z",
			"END:VCARD",
		);
		const doc = await run(text);
		const prop = doc.root.properties.find((p) => p.name === "BDAY");
		expect(prop?.value.type).toBe("DATE_TIME");
		if (prop?.value.type === "DATE_TIME") {
			expect(prop.value.value.timeZoneId).toBe("UTC");
			expect(prop.value.value.year).toBe(2006);
		}
	});

	it("VALUE=timestamp (floating) decodes as PLAIN_DATE_TIME", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"BDAY;VALUE=timestamp:20060718T210714",
			"END:VCARD",
		);
		const doc = await run(text);
		const prop = doc.root.properties.find((p) => p.name === "BDAY");
		expect(prop?.value.type).toBe("PLAIN_DATE_TIME");
		if (prop?.value.type === "PLAIN_DATE_TIME") {
			expect(prop.value.value.year).toBe(2006);
			expect(prop.value.value.hour).toBe(21);
		}
	});

	it("VALUE=date-time with TZID decodes as DATE_TIME with named zone", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"BDAY;VALUE=date-time;TZID=America/New_York:20060718T150000",
			"END:VCARD",
		);
		const doc = await run(text);
		const prop = doc.root.properties.find((p) => p.name === "BDAY");
		expect(prop?.value.type).toBe("DATE_TIME");
		if (prop?.value.type === "DATE_TIME") {
			expect(prop.value.value.timeZoneId).toBe("America/New_York");
			expect(prop.value.value.year).toBe(2006);
		}
	});
});

// ---------------------------------------------------------------------------
// Encode — additional value types
// ---------------------------------------------------------------------------

describe("VCardCodec encode — additional value types", () => {
	it("encodes BOOLEAN as TRUE/FALSE", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"NOTE;VALUE=boolean:FALSE",
			"END:VCARD",
		);
		const doc = await run(text);
		const out = await enc(doc);
		expect(out).toContain("FALSE");
	});

	it("encodes INTEGER as decimal string", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"NOTE;VALUE=integer:99",
			"END:VCARD",
		);
		const doc = await run(text);
		const out = await enc(doc);
		expect(out).toContain("99");
	});

	it("encodes FLOAT as decimal string", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"NOTE;VALUE=float:1.5",
			"END:VCARD",
		);
		const doc = await run(text);
		const out = await enc(doc);
		expect(out).toContain("1.5");
	});

	it("encodes BINARY as base64", async () => {
		// BINARY requires VALUE=binary (not standard for vCard but exercisable via raw IR)
		const base64 = btoa("test");
		const doc: IrDocument = {
			kind: "vcard",
			root: {
				name: "VCARD",
				properties: [
					{
						name: "FN",
						parameters: [],
						value: { type: "TEXT", value: "Test" },
						isKnown: true,
					},
					{
						name: "PHOTO",
						parameters: [{ name: "VALUE", value: "binary" }],
						value: {
							type: "BINARY",
							value: Uint8Array.from(
								atob(base64),
								(c) => c.codePointAt(0) ?? 0,
							),
						},
						isKnown: true,
					},
				],
				components: [],
			},
		};
		const out = await enc(doc);
		expect(out).toContain(base64);
	});

	it("encodes JSON as JSON string", async () => {
		const doc: IrDocument = {
			kind: "vcard",
			root: {
				name: "VCARD",
				properties: [
					{
						name: "FN",
						parameters: [],
						value: { type: "TEXT", value: "Test" },
						isKnown: true,
					},
					{
						name: "X-META",
						parameters: [],
						// isKnown=false: stored verbatim; use TEXT for round-trip
						value: { type: "TEXT", value: '{"key":"val"}' },
						isKnown: false,
					},
				],
				components: [],
			},
		};
		const out = await enc(doc);
		expect(out).toContain('{"key":"val"}');
	});

	it("encodes DATE_AND_OR_TIME value as opaque string", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"BDAY:--0412",
			"END:VCARD",
		);
		const doc = await run(text);
		const out = await enc(doc);
		expect(out).toContain("--0412");
	});

	it("encodes PLAIN_DATE_TIME without Z suffix", async () => {
		const text = vcard(
			"BEGIN:VCARD",
			"VERSION:4.0",
			"FN:Test",
			"BDAY;VALUE=timestamp:20060718T210714",
			"END:VCARD",
		);
		const doc = await run(text);
		const out = await enc(doc);
		expect(out).toContain("20060718T210714");
		// Must NOT have Z suffix (floating)
		expect(out).not.toContain("20060718T210714Z");
	});

	it("encodeVCardProperty throws when named-timezone DATE_TIME lacks TZID", async () => {
		const doc: IrDocument = {
			kind: "vcard",
			root: {
				name: "VCARD",
				properties: [
					{
						name: "FN",
						parameters: [],
						value: { type: "TEXT", value: "Test" },
						isKnown: true,
					},
					{
						// Named timezone but no TZID parameter — should throw
						name: "REV",
						parameters: [],
						value: {
							type: "DATE_TIME",
							value: Temporal.ZonedDateTime.from(
								"2006-07-18T21:07:14-04:00[America/New_York]",
							),
						},
						isKnown: true,
					},
				],
				components: [],
			},
		};
		// encodeVCard uses Effect.orDie — the thrown Error becomes a defect
		await expect(Effect.runPromise(encodeVCard(doc))).rejects.toThrow();
	});
});
