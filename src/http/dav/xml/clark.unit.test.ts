import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { normalizeClarkNames } from "./clark.ts";

describe("normalizeClarkNames", () => {
	it("normalizes a prefixed element key to Clark notation", () => {
		const input = { "D:prop": { "@_xmlns:D": "DAV:", "#text": "value" } };
		const result = normalizeClarkNames(input) as Record<string, unknown>;
		expect("{DAV:}prop" in result).toBe(true);
		expect("D:prop" in result).toBe(false);
	});

	it("produces the same Clark key regardless of which prefix the client used", () => {
		const withD = normalizeClarkNames({
			"D:prop": { "@_xmlns:D": "DAV:" },
		}) as Record<string, unknown>;
		const withA = normalizeClarkNames({
			"A:prop": { "@_xmlns:A": "DAV:" },
		}) as Record<string, unknown>;
		expect("{DAV:}prop" in withD).toBe(true);
		expect("{DAV:}prop" in withA).toBe(true);
	});

	it("normalizes a default namespace to Clark notation", () => {
		const input = { prop: { "@_xmlns": "DAV:", "#text": "value" } };
		const result = normalizeClarkNames(input) as Record<string, unknown>;
		expect("{DAV:}prop" in result).toBe(true);
	});

	it("nested elements inherit the parent prefix map", () => {
		const input = {
			"D:root": {
				"@_xmlns:D": "DAV:",
				"D:child": { "D:grandchild": "leaf" },
			},
		};
		const result = normalizeClarkNames(input) as Record<string, unknown>;
		const root = result["{DAV:}root"] as Record<string, unknown>;
		expect("{DAV:}child" in root).toBe(true);
		const child = root["{DAV:}child"] as Record<string, unknown>;
		expect("{DAV:}grandchild" in child).toBe(true);
	});

	it("removes xmlns:* attributes from the output", () => {
		const input = { "D:prop": { "@_xmlns:D": "DAV:", "D:child": "value" } };
		const result = normalizeClarkNames(input) as Record<string, unknown>;
		const prop = result["{DAV:}prop"] as Record<string, unknown>;
		expect("@_xmlns:D" in prop).toBe(false);
		expect("@_xmlns" in prop).toBe(false);
	});

	it("removes the default xmlns attribute from the output", () => {
		const input = { prop: { "@_xmlns": "DAV:", child: "value" } };
		const result = normalizeClarkNames(input) as Record<string, unknown>;
		const prop = result["{DAV:}prop"] as Record<string, unknown>;
		expect("@_xmlns" in prop).toBe(false);
	});

	it("passes through unprefixed keys when no default namespace is declared", () => {
		const input = { "D:root": { "@_xmlns:D": "DAV:", unqualified: "x" } };
		const result = normalizeClarkNames(input) as Record<string, unknown>;
		const root = result["{DAV:}root"] as Record<string, unknown>;
		// No default namespace → "unqualified" stays as-is
		expect("unqualified" in root).toBe(true);
	});

	it("normalizes prefixed attribute keys to Clark form", () => {
		const input = {
			"D:prop": { "@_xmlns:D": "DAV:", "@_D:attr": "val" },
		};
		const result = normalizeClarkNames(input) as Record<string, unknown>;
		const prop = result["{DAV:}prop"] as Record<string, unknown>;
		expect("@_{DAV:}attr" in prop).toBe(true);
		expect("@_D:attr" in prop).toBe(false);
	});

	it("passes through unprefixed attribute keys unchanged", () => {
		const input = { "D:comp": { "@_xmlns:D": "DAV:", "@_name": "VEVENT" } };
		const result = normalizeClarkNames(input) as Record<string, unknown>;
		const comp = result["{DAV:}comp"] as Record<string, unknown>;
		expect(comp["@_name"]).toBe("VEVENT");
	});

	it("normalizes arrays element-by-element", () => {
		const prefixMap = { "@_xmlns:D": "DAV:" };
		const input = {
			"D:root": {
				...prefixMap,
				"D:comp": [{ "@_name": "VEVENT" }, { "@_name": "VTODO" }],
			},
		};
		const result = normalizeClarkNames(input) as Record<string, unknown>;
		const root = result["{DAV:}root"] as Record<string, unknown>;
		const comp = root["{DAV:}comp"] as Array<Record<string, unknown>>;
		expect(Array.isArray(comp)).toBe(true);
		expect(comp[0]?.["@_name"]).toBe("VEVENT");
		expect(comp[1]?.["@_name"]).toBe("VTODO");
	});

	it("returns non-object values unchanged", () => {
		expect(normalizeClarkNames("hello")).toBe("hello");
		expect(normalizeClarkNames(42)).toBe(42);
		expect(normalizeClarkNames(null)).toBe(null);
	});

	it("leaves #text unresolved when a default namespace is in scope", () => {
		// KDE/Qt clients declare xmlns="DAV:" on an element that has text content.
		// Resolving the "#text" pseudo-key against that default namespace would
		// rewrite it to "{DAV:}#text" and hide the text from every reader.
		const input = { href: { "@_xmlns": "DAV:", "#text": "/a.vcf" } };
		const result = normalizeClarkNames(input) as Record<string, unknown>;
		const href = result["{DAV:}href"] as Record<string, unknown>;
		expect(href["#text"]).toBe("/a.vcf");
		expect("{DAV:}#text" in href).toBe(false);
	});

	it("leaves #text unresolved on nested elements under a default namespace", () => {
		const input = {
			multiget: {
				"@_xmlns": "urn:ietf:params:xml:ns:carddav",
				prop: { "@_xmlns": "DAV:", displayname: { "#text": "Work" } },
			},
		};
		const result = normalizeClarkNames(input) as Record<string, unknown>;
		const multiget = result[
			"{urn:ietf:params:xml:ns:carddav}multiget"
		] as Record<string, unknown>;
		const prop = multiget["{DAV:}prop"] as Record<string, unknown>;
		const displayname = prop["{DAV:}displayname"] as Record<string, unknown>;
		expect(displayname["#text"]).toBe("Work");
	});

	it("passes the XML declaration through without resolution", () => {
		const input = {
			"?xml": { "@_version": "1.0" },
			propfind: { "@_xmlns": "DAV:" },
		};
		const result = normalizeClarkNames(input) as Record<string, unknown>;
		expect("?xml" in result).toBe(true);
		expect("{DAV:}propfind" in result).toBe(true);
	});

	it("child namespace declaration is in scope for the child element's own name", () => {
		// Per XML Namespaces spec §6.1: an element's own xmlns declarations are
		// in scope for that element's name and all its descendants.
		// <D:root xmlns:D="DAV:"><D:child xmlns:D="caldav:"/></D:root>
		// → root is {DAV:}root, child is {caldav:}child
		const input = {
			"D:root": {
				"@_xmlns:D": "DAV:",
				"D:child": {
					"@_xmlns:D": "urn:ietf:params:xml:ns:caldav",
					"D:grandchild": "x",
				},
			},
		};
		const result = normalizeClarkNames(input) as Record<string, unknown>;
		const root = result["{DAV:}root"] as Record<string, unknown>;
		// child overrides D to caldav, so its name resolves with the caldav NS
		expect("{urn:ietf:params:xml:ns:caldav}child" in root).toBe(true);
		// grandchild also inherits the caldav D prefix
		const child = root["{urn:ietf:params:xml:ns:caldav}child"] as Record<
			string,
			unknown
		>;
		expect("{urn:ietf:params:xml:ns:caldav}grandchild" in child).toBe(true);
	});
});
