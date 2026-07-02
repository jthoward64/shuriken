import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import type { IrComponent, IrParameter, IrProperty } from "#src/data/ir.ts";
import { baseName, getText } from "#src/data/vcard/prop.ts";
import { mergeFormIntoVcard } from "./merge-vcard.ts";
import { parseVcardToForm } from "./parse-vcard.ts";
import type { ContactFormData } from "./types.ts";
import { emptyContactForm } from "./types.ts";

const prop = (
	name: string,
	value: string,
	parameters: ReadonlyArray<IrParameter> = [],
): IrProperty => ({
	name,
	parameters,
	value: { type: "TEXT", value },
	isKnown: !name.startsWith("X-"),
});

const vcard = (props: ReadonlyArray<IrProperty>): IrComponent => ({
	name: "VCARD",
	properties: props,
	components: [],
});

const form = (o: Partial<ContactFormData>): ContactFormData => ({
	...emptyContactForm,
	...o,
});

const names = (c: IrComponent) => c.properties.map((p) => p.name);
const find = (c: IrComponent, name: string) =>
	c.properties.find((p) => p.name === name);
const UID = "urn:uuid:x";

describe("mergeFormIntoVcard", () => {
	it("preserves metadata and generic props through parse→edit→merge", () => {
		const existing = vcard([
			prop("VERSION", "4.0"),
			prop("UID", UID),
			prop("FN", "Old Name"),
			prop("ROLE", "Engineer"),
			prop("X-ADDRESSING-GRAMMAR", "whatever"),
			prop("REV", "20240101T000000Z"),
		]);
		// Real flow: parse pre-populates the form (incl. generic otherProps).
		const edited = { ...parseVcardToForm(existing), fn: "New Name" };
		const out = mergeFormIntoVcard(existing, edited, UID);
		expect(getText(find(out, "FN"))).toBe("New Name");
		expect(getText(find(out, "ROLE"))).toBe("Engineer"); // generic-editable, preserved
		expect(getText(find(out, "X-ADDRESSING-GRAMMAR"))).toBe("whatever");
		expect(getText(find(out, "REV"))).toBe("20240101T000000Z"); // metadata verbatim
	});

	it("drops a generic prop the user cleared, but not metadata", () => {
		const existing = vcard([
			prop("VERSION", "4.0"),
			prop("UID", UID),
			prop("FN", "A"),
			prop("ROLE", "Engineer"),
			prop("REV", "20240101T000000Z"),
		]);
		// form with no otherProps → the generic ROLE is removed; REV stays.
		const out = mergeFormIntoVcard(existing, form({ fn: "A" }), UID);
		expect(find(out, "ROLE")).toBeUndefined();
		expect(getText(find(out, "REV"))).toBe("20240101T000000Z");
	});

	it("round-trips generic properties edited via otherProps (with params)", () => {
		const existing = vcard([
			prop("VERSION", "4.0"),
			prop("UID", UID),
			prop("FN", "A"),
		]);
		const out = mergeFormIntoVcard(
			existing,
			form({
				fn: "A",
				otherProps: [
					{ name: "ROLE", group: "", value: "Chief", params: "" },
					{
						name: "X-FOO",
						group: "item9",
						value: "bar",
						params: "TYPE=work;X-P=1",
					},
				],
			}),
			UID,
		);
		expect(getText(find(out, "ROLE"))).toBe("Chief");
		const xfoo = find(out, "item9.X-FOO");
		expect(getText(xfoo)).toBe("bar");
		expect(xfoo?.parameters).toEqual([
			{ name: "TYPE", value: "work" },
			{ name: "X-P", value: "1" },
		]);
	});

	it("preserves VERSION:3.0 (no forced upgrade)", () => {
		const out = mergeFormIntoVcard(
			vcard([prop("VERSION", "3.0"), prop("UID", UID), prop("FN", "A")]),
			form({ fn: "B" }),
			UID,
		);
		expect(getText(find(out, "VERSION"))).toBe("3.0");
	});

	it("edits a grouped Apple email in place, keeping group + X-ABLabel + params", () => {
		const existing = vcard([
			prop("VERSION", "3.0"),
			prop("UID", UID),
			prop("FN", "A"),
			prop("item1.EMAIL", "old@x.com", [
				{ name: "TYPE", value: "INTERNET" },
				{ name: "X-FOO", value: "bar" },
			]),
			prop("item1.X-ABLABEL", "_$!<Home>!$_"),
		]);
		const out = mergeFormIntoVcard(
			existing,
			form({ fn: "A", emails: [{ value: "new@x.com", types: ["home"] }] }),
			UID,
		);
		const email = find(out, "item1.EMAIL");
		expect(getText(email)).toBe("new@x.com");
		// group kept, X-ABLabel sibling kept, non-TYPE param kept, TYPE updated
		expect(names(out)).toContain("item1.X-ABLABEL");
		expect(email?.parameters).toContainEqual({ name: "X-FOO", value: "bar" });
		expect(email?.parameters).toContainEqual({ name: "TYPE", value: "home" });
	});

	it("removing an email drops it and its orphaned X-ABLabel", () => {
		const existing = vcard([
			prop("VERSION", "3.0"),
			prop("UID", UID),
			prop("FN", "A"),
			prop("item1.EMAIL", "old@x.com"),
			prop("item1.X-ABLABEL", "_$!<Home>!$_"),
		]);
		const out = mergeFormIntoVcard(
			existing,
			form({ fn: "A", emails: [] }),
			UID,
		);
		expect(names(out)).not.toContain("item1.EMAIL");
		expect(names(out)).not.toContain("item1.X-ABLABEL");
	});

	it("appends a newly added email as a bare property", () => {
		const existing = vcard([
			prop("VERSION", "4.0"),
			prop("UID", UID),
			prop("FN", "A"),
		]);
		const out = mergeFormIntoVcard(
			existing,
			form({ fn: "A", emails: [{ value: "a@x.com", types: ["work"] }] }),
			UID,
		);
		const email = find(out, "EMAIL");
		expect(getText(email)).toBe("a@x.com");
		expect(email?.parameters).toContainEqual({ name: "TYPE", value: "work" });
	});

	it("preserves N additional/prefix/suffix, replacing only family+given", () => {
		const existing = vcard([
			prop("VERSION", "4.0"),
			prop("UID", UID),
			prop("FN", "A"),
			prop("N", "Smith;John;Quincy;Dr;Jr"),
		]);
		const out = mergeFormIntoVcard(
			existing,
			form({ fn: "A", familyName: "Jones", givenName: "Jane" }),
			UID,
		);
		expect(getText(find(out, "N"))).toBe("Jones;Jane;Quincy;Dr;Jr");
	});

	it("keeps multiple grouped emails paired positionally", () => {
		const existing = vcard([
			prop("VERSION", "3.0"),
			prop("UID", UID),
			prop("FN", "A"),
			prop("item1.EMAIL", "a@x.com"),
			prop("item2.EMAIL", "b@x.com"),
		]);
		const out = mergeFormIntoVcard(
			existing,
			form({
				fn: "A",
				emails: [
					{ value: "a@x.com", types: [] },
					{ value: "B2@x.com", types: [] },
				],
			}),
			UID,
		);
		expect(getText(find(out, "item1.EMAIL"))).toBe("a@x.com");
		expect(getText(find(out, "item2.EMAIL"))).toBe("B2@x.com");
	});

	it("adds VERSION/UID when a card somehow lacks them", () => {
		const out = mergeFormIntoVcard(
			vcard([prop("FN", "A")]),
			form({ fn: "A" }),
			UID,
		);
		expect(baseName(out.properties[0]?.name ?? "")).toBe("VERSION");
		expect(getText(find(out, "UID"))).toBe(UID);
	});

	it("edits grouped TEL and URL in place, keeping groups", () => {
		const existing = vcard([
			prop("VERSION", "3.0"),
			prop("UID", UID),
			prop("FN", "A"),
			prop("item1.TEL", "+1 555", [{ name: "TYPE", value: "CELL" }]),
			prop("item2.URL", "https://old.example"),
		]);
		const out = mergeFormIntoVcard(
			existing,
			form({
				fn: "A",
				tels: [{ value: "+1 999", types: ["work"] }],
				urls: ["https://new.example"],
			}),
			UID,
		);
		expect(getText(find(out, "item1.TEL"))).toBe("+1 999");
		expect(find(out, "item1.TEL")?.parameters).toContainEqual({
			name: "TYPE",
			value: "work",
		});
		expect(getText(find(out, "item2.URL"))).toBe("https://new.example");
	});

	it("edits an ADR in place with billing/delivery types", () => {
		const existing = vcard([
			prop("VERSION", "4.0"),
			prop("UID", UID),
			prop("FN", "A"),
			prop("ADR", ";;1 Old St;Town;;;", [{ name: "TYPE", value: "home" }]),
		]);
		const out = mergeFormIntoVcard(
			existing,
			form({
				fn: "A",
				addresses: [
					{
						poBox: "",
						extended: "",
						street: "2 New Rd",
						locality: "City",
						region: "",
						postalCode: "",
						country: "",
						types: ["billing", "delivery"],
					},
				],
			}),
			UID,
		);
		const adr = find(out, "ADR");
		expect(getText(adr)).toBe(";;2 New Rd;City;;;");
		expect(adr?.parameters).toContainEqual({
			name: "TYPE",
			value: "billing,delivery",
		});
	});

	it("drops a single field that was cleared in the form", () => {
		const existing = vcard([
			prop("VERSION", "4.0"),
			prop("UID", UID),
			prop("FN", "A"),
			prop("ORG", "Acme"),
		]);
		const out = mergeFormIntoVcard(existing, form({ fn: "A", org: "" }), UID);
		expect(find(out, "ORG")).toBeUndefined();
	});

	it("keeps a label when its group still has a surviving partner", () => {
		const existing = vcard([
			prop("VERSION", "3.0"),
			prop("UID", UID),
			prop("FN", "A"),
			prop("item1.EMAIL", "a@x.com"),
			prop("item1.URL", "https://a.example"),
			prop("item1.X-ABLABEL", "_$!<Home>!$_"),
		]);
		// remove the email row, but keep the URL row → label still labels the URL
		const out = mergeFormIntoVcard(
			existing,
			form({ fn: "A", emails: [], urls: ["https://a.example"] }),
			UID,
		);
		expect(names(out)).not.toContain("item1.EMAIL");
		expect(names(out)).toContain("item1.URL");
		expect(names(out)).toContain("item1.X-ABLABEL");
	});

	it("sets a per-email LABEL param on in-place edit", () => {
		const existing = vcard([
			prop("VERSION", "4.0"),
			prop("UID", UID),
			prop("FN", "A"),
			prop("EMAIL", "a@x.com", [{ name: "TYPE", value: "home" }]),
		]);
		const out = mergeFormIntoVcard(
			existing,
			form({
				fn: "A",
				emails: [{ value: "a@x.com", types: ["home"], label: "Personal" }],
			}),
			UID,
		);
		expect(find(out, "EMAIL")?.parameters).toContainEqual({
			name: "LABEL",
			value: "Personal",
		});
	});

	it("preserves nested components", () => {
		const existing: IrComponent = {
			name: "VCARD",
			properties: [prop("VERSION", "4.0"), prop("UID", UID), prop("FN", "A")],
			components: [{ name: "X-CHILD", properties: [], components: [] }],
		};
		const out = mergeFormIntoVcard(existing, form({ fn: "B" }), UID);
		expect(out.components).toEqual(existing.components);
	});
});
