import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import { cn } from "#src/data/ir.ts";
import { buildMultistatus, multistatusResponse } from "./multistatus.ts";
import { parseXml } from "./parser.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const DAV = "DAV:";
const CALDAV = "urn:ietf:params:xml:ns:caldav";

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

// ---------------------------------------------------------------------------
// buildMultistatus
// ---------------------------------------------------------------------------

describe("buildMultistatus", () => {
	it("produces XML with a D:multistatus root element", async () => {
		const xml = await Effect.runPromise(
			buildMultistatus([
				{ href: "/dav/", propstats: [{ props: {}, status: 200 }] },
			]),
		);
		expect(xml).toContain("multistatus");
	});

	it("emits DAV namespace declaration on the root element", async () => {
		const xml = await Effect.runPromise(
			buildMultistatus([
				{ href: "/dav/", propstats: [{ props: {}, status: 200 }] },
			]),
		);
		expect(xml).toContain("xmlns");
		expect(xml).toContain("DAV:");
	});

	it("includes the href for each response", async () => {
		const xml = await Effect.runPromise(
			buildMultistatus([
				{
					href: "/dav/principals/alice/",
					propstats: [{ props: {}, status: 200 }],
				},
			]),
		);
		expect(xml).toContain("/dav/principals/alice/");
	});

	it("emits a 200 status line in the propstat", async () => {
		const xml = await Effect.runPromise(
			buildMultistatus([
				{ href: "/dav/", propstats: [{ props: {}, status: 200 }] },
			]),
		);
		expect(xml).toContain("HTTP/1.1 200 OK");
	});

	it("emits a 404 status line for missing properties", async () => {
		const xml = await Effect.runPromise(
			buildMultistatus([
				{
					href: "/dav/",
					propstats: [
						{ props: { [cn(DAV, "displayname")]: "My Cal" }, status: 200 },
						{ props: { [cn(DAV, "getetag")]: "" }, status: 404 },
					],
				},
			]),
		);
		expect(xml).toContain("HTTP/1.1 200 OK");
		expect(xml).toContain("HTTP/1.1 404 Not Found");
	});

	it("splits found and not-found properties into separate propstat blocks", async () => {
		const xml = await Effect.runPromise(
			buildMultistatus([
				{
					href: "/a/",
					propstats: [
						{ props: { [cn(DAV, "displayname")]: "Alice" }, status: 200 },
						{ props: { [cn(DAV, "getetag")]: "" }, status: 404 },
					],
				},
			]),
		);
		const parsed = element(
			await Effect.runPromise(parseXml(xml).pipe(Effect.orDie)),
		);
		// Should have at least two propstat elements (fast-xml-parser may array them)
		const resp = element(element(parsed["D:multistatus"])["D:response"]);
		const propstat = resp["D:propstat"];
		expect(Array.isArray(propstat)).toBe(true);
		expect(Array.isArray(propstat) ? propstat.length : 0).toBe(2);
	});

	it("emits multiple D:response elements for multiple resources", async () => {
		const xml = await Effect.runPromise(
			buildMultistatus([
				{ href: "/a/", propstats: [{ props: {}, status: 200 }] },
				{ href: "/b/", propstats: [{ props: {}, status: 200 }] },
			]),
		);
		expect(xml).toContain("/a/");
		expect(xml).toContain("/b/");
		const matches = xml.match(/<[A-Z]+:response/gu);
		expect(matches?.length).toBeGreaterThanOrEqual(2);
	});

	it("emits Clark-keyed property values using canonical prefixes", async () => {
		const xml = await Effect.runPromise(
			buildMultistatus([
				{
					href: "/dav/principals/alice/cal/primary/",
					propstats: [
						{
							props: {
								[cn(DAV, "displayname")]: "Primary Calendar",
								[cn(CALDAV, "calendar-description")]: "Work events",
							},
							status: 200,
						},
					],
				},
			]),
		);
		expect(xml).toContain("Primary Calendar");
		expect(xml).toContain("Work events");
		// Both namespaces declared (DAV: always "D:", caldav always "C:")
		expect(xml).toContain('xmlns:D="DAV:"');
		expect(xml).toContain(`xmlns:C="${CALDAV}"`);
	});

	it("two different Clark keys in the same namespace share one xmlns declaration", async () => {
		const xml = await Effect.runPromise(
			buildMultistatus([
				{
					href: "/x/",
					propstats: [
						{
							props: {
								[cn(DAV, "displayname")]: "Name",
								[cn(DAV, "getlastmodified")]: "Mon, 01 Jan 2024 00:00:00 GMT",
							},
							status: 200,
						},
					],
				},
			]),
		);
		// xmlns:D appears exactly once
		const count = (xml.match(/xmlns:D=/gu) ?? []).length;
		expect(count).toBe(1);
	});

	it("unknown namespace gets a generated prefix and xmlns declaration", async () => {
		const unknownNs = "http://example.com/ns/";
		const xml = await Effect.runPromise(
			buildMultistatus([
				{
					href: "/x/",
					propstats: [
						{
							props: { [cn(unknownNs, "color")]: "red" },
							status: 200,
						},
					],
				},
			]),
		);
		expect(xml).toContain(unknownNs);
		expect(xml).toContain("red");
	});
});

// ---------------------------------------------------------------------------
// multistatusResponse
// ---------------------------------------------------------------------------

describe("multistatusResponse", () => {
	it("returns a 207 Response", async () => {
		const res = await Effect.runPromise(
			multistatusResponse([
				{ href: "/dav/", propstats: [{ props: {}, status: 200 }] },
			]),
		);
		expect(res.status).toBe(207);
	});

	it("sets Content-Type to application/xml; charset=utf-8", async () => {
		const res = await Effect.runPromise(
			multistatusResponse([
				{ href: "/dav/", propstats: [{ props: {}, status: 200 }] },
			]),
		);
		expect(res.headers.get("Content-Type")).toBe(
			"application/xml; charset=utf-8",
		);
	});
});
