import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import type { IrComponent, IrProperty } from "#src/data/ir.ts";
import {
	completenessScore,
	mergeVcards,
	pickPrimaryIndex,
} from "./merge-vcard.ts";

const text = (name: string, value: string): IrProperty => ({
	name,
	parameters: [],
	value: { type: "TEXT", value },
	isKnown: true,
});

const vcard = (props: ReadonlyArray<IrProperty>): IrComponent => ({
	name: "VCARD",
	properties: [text("VERSION", "4.0"), ...props],
	components: [],
});

describe("completenessScore", () => {
	it("counts properties excluding VERSION and UID", () => {
		const v = vcard([
			text("UID", "urn:uuid:1"),
			text("FN", "Alice"),
			text("EMAIL", "a@x.com"),
		]);
		expect(completenessScore(v)).toBe(2);
	});
});

describe("pickPrimaryIndex", () => {
	it("prefers the most complete card", () => {
		const sparse = vcard([text("FN", "A")]);
		const rich = vcard([text("FN", "A"), text("EMAIL", "a@x.com")]);
		expect(
			pickPrimaryIndex([
				{ vcard: sparse, lastModified: "2026-01-01" },
				{ vcard: rich, lastModified: "2026-01-01" },
			]),
		).toBe(1);
	});

	it("breaks completeness ties by most recent lastModified", () => {
		const a = vcard([text("FN", "A")]);
		const b = vcard([text("FN", "A")]);
		expect(
			pickPrimaryIndex([
				{ vcard: a, lastModified: "2026-01-01" },
				{ vcard: b, lastModified: "2026-06-01" },
			]),
		).toBe(1);
	});
});

describe("mergeVcards", () => {
	it("keeps the primary's single-valued fields", () => {
		const primary = vcard([
			text("FN", "Jonathan Doe"),
			text("N", "Doe;Jonathan;;;"),
		]);
		const other = vcard([text("FN", "Jon"), text("N", "Doe;Jon;;;")]);
		const merged = mergeVcards(primary, [other]);
		const fn = merged.properties.filter((p) => p.name === "FN");
		expect(fn).toHaveLength(1);
		expect(propText(fn[0])).toBe("Jonathan Doe");
	});

	it("fills a single-valued field the primary is missing", () => {
		const primary = vcard([text("FN", "Alice")]);
		const other = vcard([text("FN", "Alice"), text("ORG", "Acme")]);
		const merged = mergeVcards(primary, [other]);
		const org = merged.properties.filter((p) => p.name === "ORG");
		expect(org).toHaveLength(1);
		expect(propText(org[0])).toBe("Acme");
	});

	it("unions multi-valued emails/phones, deduping by normalized value", () => {
		const primary = vcard([
			text("FN", "Alice"),
			text("EMAIL", "alice@x.com"),
			text("TEL", "+1 555 123 4567"),
		]);
		const other = vcard([
			text("FN", "Alice"),
			text("EMAIL", "ALICE@X.COM"), // duplicate (case)
			text("EMAIL", "alice@work.com"), // new
			text("TEL", "1-555-123-4567"), // duplicate (formatting)
		]);
		const merged = mergeVcards(primary, [other]);
		const emails = merged.properties
			.filter((p) => p.name === "EMAIL")
			.map(propText);
		const tels = merged.properties.filter((p) => p.name === "TEL");
		expect(emails).toEqual(["alice@x.com", "alice@work.com"]);
		expect(tels).toHaveLength(1);
	});

	it("preserves unknown/extension properties from secondaries", () => {
		const primary = vcard([text("FN", "Alice")]);
		const other: IrComponent = {
			name: "VCARD",
			properties: [
				text("VERSION", "4.0"),
				text("FN", "Alice"),
				{
					name: "X-CUSTOM",
					parameters: [],
					value: { type: "TEXT", value: "keepme" },
					isKnown: false,
				},
			],
			components: [],
		};
		const merged = mergeVcards(primary, [other]);
		const custom = merged.properties.filter((p) => p.name === "X-CUSTOM");
		expect(custom).toHaveLength(1);
		expect(propText(custom[0])).toBe("keepme");
	});
});

const propText = (p: IrProperty | undefined): string =>
	p?.value.type === "TEXT" ? p.value.value : "";
