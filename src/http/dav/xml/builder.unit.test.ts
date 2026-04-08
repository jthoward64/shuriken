import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { buildXml } from "./builder.ts";
import { parseXml } from "./parser.ts";

// ---------------------------------------------------------------------------
// buildXml
//
// Tests verify the builder configuration: attributeNamePrefix = "@_",
// suppressEmptyNode = true, format = false (compact output).
// ---------------------------------------------------------------------------

describe("buildXml", () => {
	// --- Output format -------------------------------------------------------

	it("produces compact output with no newlines or extra whitespace (format: false)", async () => {
		const xml = await Effect.runPromise(
			buildXml({ "D:root": { "@_xmlns:D": "DAV:", "D:child": "hello" } }),
		);
		expect(xml).not.toContain("\n");
	});

	// --- Attribute rendering -------------------------------------------------

	it("renders @_-prefixed keys as XML attributes on the element", async () => {
		const xml = await Effect.runPromise(
			buildXml({ root: { "@_xmlns": "DAV:", "@_version": "1.0" } }),
		);
		expect(xml).toContain('xmlns="DAV:"');
		expect(xml).toContain('version="1.0"');
	});

	it("renders namespace-prefixed attributes", async () => {
		const xml = await Effect.runPromise(
			buildXml({ "D:root": { "@_xmlns:D": "DAV:" } }),
		);
		expect(xml).toContain('xmlns:D="DAV:"');
	});

	// --- Empty node suppression (suppressEmptyNode: true) --------------------

	it("renders elements with empty-string value as self-closing tags", async () => {
		const xml = await Effect.runPromise(
			buildXml({
				"D:prop": {
					"@_xmlns:D": "DAV:",
					"D:getcontenttype": "",
					"D:getetag": "",
				},
			}),
		);
		expect(xml).toContain("<D:getcontenttype/>");
		expect(xml).toContain("<D:getetag/>");
	});

	// --- Arrays → repeated same-named elements ------------------------------

	it("serializes an array as repeated sibling elements with the same tag", async () => {
		// Arrays in the input object produce multiple elements with the same name.
		// This is how multi-value PROPFIND responses are constructed.
		const xml = await Effect.runPromise(
			buildXml({
				"D:multistatus": {
					"@_xmlns:D": "DAV:",
					"D:response": [
						{ "D:href": "/a/", "D:status": "HTTP/1.1 200 OK" },
						{ "D:href": "/b/", "D:status": "HTTP/1.1 404 Not Found" },
					],
				},
			}),
		);
		// Both hrefs must appear in the output
		expect(xml).toContain("/a/");
		expect(xml).toContain("/b/");
		// Two D:response opening tags
		const matches = xml.match(/<D:response/g);
		expect(matches?.length).toBe(2);
	});

	// --- Round-trip: build then parse ----------------------------------------

	it("round-trips a DAV error body: build → parse returns equivalent structure", async () => {
		const obj = {
			"D:error": {
				"@_xmlns:D": "DAV:",
				"D:need-privileges": "",
			},
		};
		const xml = await Effect.runPromise(buildXml(obj));
		const parsed = (await Effect.runPromise(parseXml(xml))) as Record<
			string,
			unknown
		>;

		const error = parsed["D:error"] as Record<string, unknown>;
		expect(error["@_xmlns:D"]).toBe("DAV:");
		expect("D:need-privileges" in error).toBe(true);
	});

	it("round-trips a multistatus response: hrefs and statuses survive intact", async () => {
		const obj = {
			"D:multistatus": {
				"@_xmlns:D": "DAV:",
				"D:response": [
					{ "D:href": "/dav/principals/alice/", "D:status": "HTTP/1.1 200 OK" },
					{
						"D:href": "/dav/principals/bob/",
						"D:status": "HTTP/1.1 403 Forbidden",
					},
				],
			},
		};
		const xml = await Effect.runPromise(buildXml(obj));
		const parsed = (await Effect.runPromise(parseXml(xml))) as Record<
			string,
			unknown
		>;

		const ms = parsed["D:multistatus"] as Record<string, unknown>;
		const responses = ms["D:response"] as Array<Record<string, unknown>>;
		expect(Array.isArray(responses)).toBe(true);
		expect(responses[0]?.["D:href"]).toBe("/dav/principals/alice/");
		expect(responses[1]?.["D:status"]).toBe("HTTP/1.1 403 Forbidden");
	});
});
