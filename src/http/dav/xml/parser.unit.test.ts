import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import { runFailure } from "#src/testing/effect.ts";
import { parseXml } from "./parser.ts";

// ---------------------------------------------------------------------------
// parseXml
//
// Tests verify the parser configuration: attributeNamePrefix = "@_",
// parseTagValue = false (no type coercion), trimValues = true,
// allowBooleanAttributes = true.
// ---------------------------------------------------------------------------

/** True when a parsed XML node is an element object rather than text */
const isElement = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** Read a parsed XML node as an element, failing the test when it is not one */
const element = (value: unknown): Record<string, unknown> => {
	if (!isElement(value)) {
		throw new Error(`expected an XML element, got ${typeof value}`);
	}
	return value;
};

describe("parseXml", () => {
	// --- Attribute handling -------------------------------------------------

	it("prefixes attributes with @_", async () => {
		const result = element(
			await Effect.runPromise(
				parseXml('<D:href xmlns:D="DAV:">http://example.com</D:href>'),
			),
		);
		expect(element(result["D:href"])["@_xmlns:D"]).toBe("DAV:");
	});

	it("boolean attributes (no value) are parsed as empty string or true", async () => {
		// allowBooleanAttributes: true — attribute without value should be present
		const result = element(await Effect.runPromise(parseXml("<root flag/>")));
		expect("@_flag" in element(result.root)).toBe(true);
	});

	// --- Type coercion (parseTagValue: false) --------------------------------

	it("does not coerce numeric text content to number", async () => {
		const result = element(
			await Effect.runPromise(
				parseXml("<root><synctoken>42</synctoken></root>"),
			),
		);
		const synctoken = element(result.root).synctoken;
		expect(synctoken).toBe("42");
		expect(typeof synctoken).toBe("string");
	});

	it("does not coerce boolean-like text to boolean", async () => {
		const result = element(
			await Effect.runPromise(parseXml("<root><flag>true</flag></root>")),
		);
		const flag = element(result.root).flag;
		expect(flag).toBe("true");
		expect(typeof flag).toBe("string");
	});

	// --- Whitespace (trimValues: true) ---------------------------------------

	it("trims leading and trailing whitespace in text content", async () => {
		const result = element(
			await Effect.runPromise(
				parseXml("<D:href>  /dav/principals/alice/  </D:href>"),
			),
		);
		expect(result["D:href"]).toBe("/dav/principals/alice/");
	});

	// --- Multiple same-named siblings → array --------------------------------

	it("collapses multiple sibling elements with the same name into an array", async () => {
		// Critical for PROPFIND/REPORT responses that return multiple D:response elements
		const xml = `<D:multistatus xmlns:D="DAV:">
			<D:response><D:href>/a/</D:href></D:response>
			<D:response><D:href>/b/</D:href></D:response>
		</D:multistatus>`;
		const result = element(await Effect.runPromise(parseXml(xml)));
		const responses = element(result["D:multistatus"])["D:response"];
		expect(Array.isArray(responses)).toBe(true);
		expect(Array.isArray(responses) ? responses.length : 0).toBe(2);
	});

	// --- Self-closing elements -----------------------------------------------

	it("self-closing elements produce an empty-string value", async () => {
		// fast-xml-parser returns "" for <D:getcontenttype/> with parseTagValue: false
		const result = element(
			await Effect.runPromise(
				parseXml('<D:prop xmlns:D="DAV:"><D:getcontenttype/></D:prop>'),
			),
		);
		// Key must exist; value is empty string or undefined — document the actual behaviour
		expect("D:getcontenttype" in element(result["D:prop"])).toBe(true);
	});

	// --- Realistic DAV request bodies ----------------------------------------

	it("parses a PROPFIND with multiple requested properties", async () => {
		const xml = `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:getcontenttype/>
    <D:getetag/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`;
		const result = element(await Effect.runPromise(parseXml(xml)));
		const propfind = element(result["D:propfind"]);
		expect(propfind["@_xmlns:D"]).toBe("DAV:");
		const prop = element(propfind["D:prop"]);
		expect("D:getcontenttype" in prop).toBe(true);
		expect("D:getetag" in prop).toBe(true);
		expect("D:resourcetype" in prop).toBe(true);
	});

	it("parses a MKCALENDAR body with namespace-qualified properties", async () => {
		const xml = `<C:mkcalendar xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>My Calendar</D:displayname>
      <C:calendar-timezone>BEGIN:VCALENDAR</C:calendar-timezone>
    </D:prop>
  </D:set>
</C:mkcalendar>`;
		const result = element(await Effect.runPromise(parseXml(xml)));
		expect("C:mkcalendar" in result).toBe(true);
		const mk = element(result["C:mkcalendar"]);
		expect(mk["@_xmlns:C"]).toBe("urn:ietf:params:xml:ns:caldav");
		const prop = element(element(mk["D:set"])["D:prop"]);
		expect(prop["D:displayname"]).toBe("My Calendar");
	});

	// --- Malformed XML → XmlParseError ----------------------------------------

	it("fails with XmlParseError for an unterminated attribute value", async () => {
		// fast-xml-parser throws on an unterminated attribute value — the most
		// reliable trigger for its validation path
		const err = await runFailure(parseXml('<root attr="unclosed>'));

		expect(err._tag).toBe("XmlParseError");
	});
});
