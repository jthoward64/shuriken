import { describe, expect, it } from "bun:test";
import { Effect, Schema } from "effect";
import { runFailure } from "#src/testing/effect.ts";
import { type ContentLine, ContentLinesCodec } from "./content-line.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const decodeEffect = Schema.decode(ContentLinesCodec);
const encodeEffect = Schema.encode(ContentLinesCodec);

const dec = (text: string) => Effect.runPromise(decodeEffect(text));
const enc = (lines: ReadonlyArray<ContentLine>) =>
	Effect.runPromise(encodeEffect(lines));


// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

describe("ContentLinesCodec decode", () => {
	it("decodes a CRLF-terminated block into the correct ContentLine array", async () => {
		const text = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n";
		const lines = await dec(text);
		expect(lines).toHaveLength(3);
		expect(lines[0]).toMatchObject({ name: "BEGIN", rawValue: "VCALENDAR" });
		expect(lines[1]).toMatchObject({ name: "VERSION", rawValue: "2.0" });
		expect(lines[2]).toMatchObject({ name: "END", rawValue: "VCALENDAR" });
	});

	it("normalizes lone \\n to \\r\\n before splitting", async () => {
		const text = "BEGIN:VCALENDAR\nVERSION:2.0\nEND:VCALENDAR\n";
		const lines = await dec(text);
		expect(lines).toHaveLength(3);
		expect(lines[1]).toMatchObject({ name: "VERSION", rawValue: "2.0" });
	});

	it("normalizes bare \\r to \\r\\n before splitting", async () => {
		const text = "BEGIN:VCALENDAR\rVERSION:2.0\rEND:VCALENDAR\r";
		const lines = await dec(text);
		expect(lines).toHaveLength(3);
	});

	it("unfolds \\r\\n<SPACE> continuation lines", async () => {
		const text = "DESCRIPTION:This is a lon\r\n g description\r\n";
		const lines = await dec(text);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({
			name: "DESCRIPTION",
			rawValue: "This is a long description",
		});
	});

	it("unfolds \\r\\n<TAB> continuation lines", async () => {
		const text = "SUMMARY:Hello\r\n\tWorld\r\n";
		const lines = await dec(text);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ rawValue: "HelloWorld" });
	});

	it("parses a property with a single parameter", async () => {
		const text = "DTSTART;TZID=America/New_York:19980119T020000\r\n";
		const lines = await dec(text);
		expect(lines[0]).toMatchObject({
			name: "DTSTART",
			params: [{ name: "TZID", values: ["America/New_York"] }],
			rawValue: "19980119T020000",
		});
	});

	it("parses a property with multiple parameters", async () => {
		const text = "ATTENDEE;RSVP=TRUE;ROLE=REQ-PARTICIPANT:mailto:jsmith@example.com\r\n";
		const lines = await dec(text);
		expect(lines[0]?.params).toHaveLength(2);
		expect(lines[0]?.params[0]).toMatchObject({ name: "RSVP", values: ["TRUE"] });
		expect(lines[0]?.params[1]).toMatchObject({
			name: "ROLE",
			values: ["REQ-PARTICIPANT"],
		});
	});

	it("preserves colons inside the value (only the first unquoted colon is the delimiter)", async () => {
		const text = "URL:http://example.com/path:with:colons\r\n";
		const lines = await dec(text);
		expect(lines[0]).toMatchObject({
			name: "URL",
			rawValue: "http://example.com/path:with:colons",
		});
	});

	it("preserves semicolons inside quoted parameter values", async () => {
		const text = 'X-PROP;PARAM="val;with;semis":rawval\r\n';
		const lines = await dec(text);
		expect(lines[0]?.params[0]).toMatchObject({
			name: "PARAM",
			values: ["val;with;semis"],
		});
	});

	it("splits multi-value parameters at unquoted commas", async () => {
		const text = "CATEGORIES;LANGUAGE=en:MEETING,APPOINTMENT\r\n";
		const lines = await dec(text);
		// LANGUAGE is a param; CATEGORIES value contains comma-separated list
		// (The comma in rawValue is intentional — it's the property value, not a param)
		expect(lines[0]).toMatchObject({ name: "CATEGORIES" });
		expect(lines[0]?.rawValue).toBe("MEETING,APPOINTMENT");
	});

	it("splits multi-value param values at unquoted commas", async () => {
		const text = 'X-PROP;TYPE=HOME,WORK:val\r\n';
		const lines = await dec(text);
		expect(lines[0]?.params[0]).toMatchObject({
			name: "TYPE",
			values: ["HOME", "WORK"],
		});
	});

	it("upper-cases property names and parameter names", async () => {
		const text = "x-custom;myParam=val:content\r\n";
		const lines = await dec(text);
		expect(lines[0]?.name).toBe("X-CUSTOM");
		expect(lines[0]?.params[0]?.name).toBe("MYPARAM");
	});

	it("fails on a line with no colon separator", async () => {
		const err = await runFailure(decodeEffect("BADLINE\r\n"));
		expect(err._tag).toBe("ParseError");
	});
});

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

describe("ContentLinesCodec encode", () => {
	it("encodes a ContentLine array to CRLF-terminated folded text", async () => {
		const lines = [
			{ name: "BEGIN", params: [], rawValue: "VCALENDAR" },
			{ name: "END", params: [], rawValue: "VCALENDAR" },
		] as const;
		const text = await enc(lines);
		expect(text).toBe("BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n");
	});

	it("folds lines at 75 UTF-8 octets", async () => {
		// 75 x's → fits on one physical line; 76 x's → must fold
		const longValue = "x".repeat(76);
		const lines = [{ name: "X-LONG", params: [], rawValue: longValue }] as const;
		const text = await enc(lines);
		const physicalLines = text.split("\r\n").filter((l) => l.length > 0);
		// First physical line must be ≤75 bytes
		const encoder = new TextEncoder();
		expect(encoder.encode(physicalLines[0]).length).toBeLessThanOrEqual(75);
		// Continuation lines start with a space
		for (const pl of physicalLines.slice(1)) {
			expect(pl.startsWith(" ")).toBe(true);
		}
	});

	it("uses \\r\\n line endings throughout", async () => {
		const lines = [{ name: "VERSION", params: [], rawValue: "2.0" }] as const;
		const text = await enc(lines);
		expect(text).not.toContain("\n\n");
		expect(text.endsWith("\r\n")).toBe(true);
		// No bare \n
		expect(text.replace(/\r\n/g, "")).not.toContain("\n");
	});

	it("appends a trailing CRLF", async () => {
		const lines = [{ name: "VERSION", params: [], rawValue: "2.0" }] as const;
		const text = await enc(lines);
		expect(text.endsWith("\r\n")).toBe(true);
	});

	it("serializes parameters in NAME=value format joined by semicolons", async () => {
		const lines = [
			{
				name: "DTSTART",
				params: [{ name: "TZID", values: ["America/New_York"] }],
				rawValue: "19980119T020000",
			},
		] as const;
		const text = await enc(lines);
		expect(text).toContain("DTSTART;TZID=America/New_York:19980119T020000");
	});

	it("quotes parameter values that contain ; : or ,", async () => {
		const lines = [
			{
				name: "X-PROP",
				params: [{ name: "P", values: ["a;b"] }],
				rawValue: "v",
			},
		] as const;
		const text = await enc(lines);
		expect(text).toContain('"a;b"');
	});
});

// ---------------------------------------------------------------------------
// RFC 6868 parameter value encoding/decoding
// ---------------------------------------------------------------------------

describe("RFC 6868 parameter value encoding", () => {
	it("decodes ^' to double-quote in parameter values", async () => {
		const text = "ATTENDEE;CN=Bob ^'Bobby^' Smith:mailto:bob@example.com\r\n";
		const lines = await dec(text);
		expect(lines[0]?.params[0]?.values[0]).toBe('Bob "Bobby" Smith');
	});

	it("decodes ^^ to ^ in parameter values", async () => {
		const text = "SUMMARY;X-TAG=foo^^bar:value\r\n";
		const lines = await dec(text);
		expect(lines[0]?.params[0]?.values[0]).toBe("foo^bar");
	});

	it("decodes ^n to newline in parameter values", async () => {
		const text = "SUMMARY;X-DESC=line1^nline2:value\r\n";
		const lines = await dec(text);
		expect(lines[0]?.params[0]?.values[0]).toBe("line1\nline2");
	});

	it("decodes ^N (uppercase) to newline in parameter values", async () => {
		const text = "SUMMARY;X-DESC=line1^Nline2:value\r\n";
		const lines = await dec(text);
		expect(lines[0]?.params[0]?.values[0]).toBe("line1\nline2");
	});

	it("encodes double-quote in parameter value using ^'", async () => {
		const lines: ReadonlyArray<ContentLine> = [
			{
				name: "ATTENDEE",
				params: [{ name: "CN", values: ['Bob "Bobby" Smith'] }],
				rawValue: "mailto:bob@example.com",
			},
		];
		const text = await enc(lines);
		expect(text).toContain("CN=Bob ^'Bobby^' Smith");
	});

	it("encodes ^ in parameter value using ^^", async () => {
		const lines: ReadonlyArray<ContentLine> = [
			{
				name: "SUMMARY",
				params: [{ name: "X-TAG", values: ["foo^bar"] }],
				rawValue: "value",
			},
		];
		const text = await enc(lines);
		expect(text).toContain("X-TAG=foo^^bar");
	});

	it("encodes newline in parameter value using ^n", async () => {
		const lines: ReadonlyArray<ContentLine> = [
			{
				name: "SUMMARY",
				params: [{ name: "X-DESC", values: ["line1\nline2"] }],
				rawValue: "value",
			},
		];
		const text = await enc(lines);
		expect(text).toContain("X-DESC=line1^nline2");
	});

	it("round-trips a parameter value containing all three RFC 6868 specials", async () => {
		const original: ReadonlyArray<ContentLine> = [
			{
				name: "SUMMARY",
				params: [{ name: "X-META", values: ['has^caret and "quote" and\nnewline'] }],
				rawValue: "value",
			},
		];
		const text = await enc(original);
		const recovered = await dec(text);
		expect(recovered[0]?.params[0]?.values[0]).toBe('has^caret and "quote" and\nnewline');
	});
});

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("ContentLinesCodec round-trip", () => {
	it("decode → encode → decode yields the same ContentLine array", async () => {
		const text = [
			"BEGIN:VCALENDAR\r\n",
			"VERSION:2.0\r\n",
			"PRODID:-//Test//EN\r\n",
			"DTSTART;TZID=America/New_York:19980119T020000\r\n",
			"END:VCALENDAR\r\n",
		].join("");
		const lines1 = await dec(text);
		const reencoded = await enc(lines1);
		const lines2 = await dec(reencoded);
		expect(lines2).toEqual(lines1);
	});

	it("encode → decode recovers the original ContentLine array", async () => {
		const original = [
			{
				name: "SUMMARY",
				params: [{ name: "LANGUAGE", values: ["en"] }],
				rawValue: "Hello World",
			},
			{ name: "VERSION", params: [], rawValue: "2.0" },
		] as const;
		const text = await enc(original);
		const recovered = await dec(text);
		expect(recovered).toEqual(original);
	});
});
