import { describe, expect, it } from "bun:test";
import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
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
		const text = vcard(
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"END:VCALENDAR",
		);
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
			expect(Temporal.PlainDate.compare(
				bday.value.value,
				Temporal.PlainDate.from({ year: 1985, month: 4, day: 12 }),
			)).toBe(0);
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
		const raw =
			"NOTE;ENCODING=QUOTED-PRINTABLE:Hello=20World";
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
