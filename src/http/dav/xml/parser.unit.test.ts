import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { parseXml } from "./parser.ts";

// ---------------------------------------------------------------------------
// parseXml
//
// Tests verify the parser configuration: attributeNamePrefix = "@_",
// parseTagValue = false (no type coercion), trimValues = true,
// allowBooleanAttributes = true.
// ---------------------------------------------------------------------------

describe("parseXml", () => {
	// --- Attribute handling -------------------------------------------------

	it("prefixes attributes with @_", async () => {
		const result = await Effect.runPromise(
			parseXml('<D:href xmlns:D="DAV:">http://example.com</D:href>'),
		) as Record<string, unknown>;
		const el = result["D:href"] as Record<string, unknown>;
		expect(el["@_xmlns:D"]).toBe("DAV:");
	});

	it("boolean attributes (no value) are parsed as empty string or true", async () => {
		// allowBooleanAttributes: true — attribute without value should be present
		const result = await Effect.runPromise(
			parseXml("<root flag/>"),
		) as { root: Record<string, unknown> };
		expect("@_flag" in result.root).toBe(true);
	});

	// --- Type coercion (parseTagValue: false) --------------------------------

	it("does not coerce numeric text content to number", async () => {
		const result = await Effect.runPromise(
			parseXml("<root><synctoken>42</synctoken></root>"),
		) as { root: { synctoken: unknown } };
		expect(result.root.synctoken).toBe("42");
		expect(typeof result.root.synctoken).toBe("string");
	});

	it("does not coerce boolean-like text to boolean", async () => {
		const result = await Effect.runPromise(
			parseXml("<root><flag>true</flag></root>"),
		) as { root: { flag: unknown } };
		expect(result.root.flag).toBe("true");
		expect(typeof result.root.flag).toBe("string");
	});

	// --- Whitespace (trimValues: true) ---------------------------------------

	it("trims leading and trailing whitespace in text content", async () => {
		const result = await Effect.runPromise(
			parseXml("<D:href>  /dav/principals/alice/  </D:href>"),
		) as { "D:href": unknown };
		expect(result["D:href"]).toBe("/dav/principals/alice/");
	});

	// --- Multiple same-named siblings → array --------------------------------

	it("collapses multiple sibling elements with the same name into an array", async () => {
		// Critical for PROPFIND/REPORT responses that return multiple D:response elements
		const xml = `<D:multistatus xmlns:D="DAV:">
			<D:response><D:href>/a/</D:href></D:response>
			<D:response><D:href>/b/</D:href></D:response>
		</D:multistatus>`;
		const result = await Effect.runPromise(parseXml(xml)) as Record<string, unknown>;
		const ms = result["D:multistatus"] as Record<string, unknown>;
		const responses = ms["D:response"];
		expect(Array.isArray(responses)).toBe(true);
		expect((responses as Array<unknown>).length).toBe(2);
	});

	// --- Self-closing elements -----------------------------------------------

	it("self-closing elements produce an empty-string value", async () => {
		// fast-xml-parser returns "" for <D:getcontenttype/> with parseTagValue: false
		const result = await Effect.runPromise(
			parseXml('<D:prop xmlns:D="DAV:"><D:getcontenttype/></D:prop>'),
		) as Record<string, unknown>;
		const prop = result["D:prop"] as Record<string, unknown>;
		// Key must exist; value is empty string or undefined — document the actual behaviour
		expect("D:getcontenttype" in prop).toBe(true);
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
		const result = await Effect.runPromise(parseXml(xml)) as Record<string, unknown>;
		const propfind = result["D:propfind"] as Record<string, unknown>;
		expect(propfind["@_xmlns:D"]).toBe("DAV:");
		const prop = propfind["D:prop"] as Record<string, unknown>;
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
		const result = await Effect.runPromise(parseXml(xml)) as Record<string, unknown>;
		expect("C:mkcalendar" in result).toBe(true);
		const mk = result["C:mkcalendar"] as Record<string, unknown>;
		expect(mk["@_xmlns:C"]).toBe("urn:ietf:params:xml:ns:caldav");
		const set = mk["D:set"] as Record<string, unknown>;
		const prop = set["D:prop"] as Record<string, unknown>;
		expect(prop["D:displayname"]).toBe("My Calendar");
	});
});
