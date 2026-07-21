import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import type { IrDocument } from "#src/data/ir.ts";
import { applyVersion, parseAddressDataSpec } from "./address-data.ts";

const CARDDAV_NS = "urn:ietf:params:xml:ns:carddav";
const cn = (local: string): string => `{${CARDDAV_NS}}${local}`;

describe("parseAddressDataSpec version", () => {
	it("reads the version attribute", () => {
		expect(parseAddressDataSpec({ "@_version": "3.0" }).version).toBe("3.0");
		expect(parseAddressDataSpec({ "@_version": "4.0" }).version).toBe("4.0");
	});

	it("ignores an unsupported version and defaults to undefined", () => {
		expect(
			parseAddressDataSpec({ "@_version": "2.1" }).version,
		).toBeUndefined();
		expect(parseAddressDataSpec(undefined).version).toBeUndefined();
	});

	it("reads version independently of prop subsetting", () => {
		const spec = parseAddressDataSpec({
			"@_version": "3.0",
			[cn("prop")]: [{ "@_name": "FN" }, { "@_name": "EMAIL" }],
		});
		expect(spec.version).toBe("3.0");
		expect(spec.allProps).toBe(false);
		expect(spec.props.has("FN")).toBe(true);
	});
});

describe("applyVersion", () => {
	const doc: IrDocument = {
		kind: "vcard",
		root: {
			name: "VCARD",
			properties: [
				{
					name: "VERSION",
					parameters: [],
					value: { type: "TEXT", value: "4.0" },
					isKnown: true,
				},
			],
			components: [],
		},
	};

	it("downgrades to 3.0 when requested", () => {
		const out = applyVersion(doc, "3.0");
		const version = out.root.properties.find((p) => p.name === "VERSION");
		expect(version?.value.type === "TEXT" && version.value.value).toBe("3.0");
	});

	it("leaves the document unchanged for 4.0 or undefined", () => {
		expect(applyVersion(doc, "4.0")).toBe(doc);
		expect(applyVersion(doc, undefined)).toBe(doc);
	});
});
