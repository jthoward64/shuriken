import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import type { IrComponent, IrParameter, IrProperty } from "#src/data/ir.ts";
import { getText } from "#src/data/vcard/prop.ts";
import { buildVcardComponent } from "./build-vcard.ts";
import { mergeFormIntoVcard } from "./merge-vcard.ts";
import { parseVcardToForm } from "./parse-vcard.ts";
import type { ContactFormData, ContactRelation } from "./types.ts";
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

const relatedProps = (c: IrComponent) =>
	c.properties.filter((p) => p.name === "RELATED");
const param = (p: IrProperty, name: string) =>
	p.parameters.find((x) => x.name.toUpperCase() === name)?.value;

const UID = "urn:uuid:x";
const TARGET_UID = "urn:uuid:019efd61-eb6a-7964-a228-9bf73a3b9cca";

describe("relations in the contact form", () => {
	it("reads a canonical RELATED into a text relation", () => {
		const parsed = parseVcardToForm(
			vcard([
				prop("FN", "Meghan"),
				prop("RELATED", "Joshua Tag Howard", [
					{ name: "VALUE", value: "text" },
					{ name: "TYPE", value: "spouse" },
					{ name: "PREF", value: "1" },
				]),
			]),
		);
		expect(parsed.relations).toEqual([
			{
				target: { kind: "text" },
				name: "Joshua Tag Howard",
				relation: "Spouse",
				preferred: true,
			},
		]);
		// It has its own widget, so it must not also appear in the generic editor.
		expect(parsed.otherProps).toEqual([]);
	});

	it("reads a preserved label in place of the coarser token", () => {
		const parsed = parseVcardToForm(
			vcard([
				prop("FN", "Meghan"),
				prop("RELATED", "Jane", [
					{ name: "TYPE", value: "parent" },
					{ name: "X-SKN-RELATION-LABEL", value: "_$!<Mother>!$_" },
				]),
			]),
		);
		expect(parsed.relations[0]?.relation).toBe("Mother");
	});

	it("reads a UID reference as a contact target with its recorded name", () => {
		const parsed = parseVcardToForm(
			vcard([
				prop("FN", "Meghan"),
				{
					name: "RELATED",
					parameters: [
						{ name: "TYPE", value: "spouse" },
						{ name: "X-SKN-RELATION-NAME", value: "Joshua Tag Howard" },
					],
					value: { type: "URI", value: TARGET_UID },
					isKnown: true,
				},
			]),
		);
		expect(parsed.relations[0]).toEqual({
			target: { kind: "contact", uid: TARGET_UID },
			name: "Joshua Tag Howard",
			relation: "Spouse",
			preferred: false,
		});
	});

	it("surfaces a legacy grouped pair that predates canonicalisation", () => {
		const parsed = parseVcardToForm(
			vcard([
				prop("FN", "Meghan"),
				prop("item2.X-ABRELATEDNAMES", "Joshua Tag Howard"),
				prop("item2.X-ABLABEL", "_$!<Spouse>!$_"),
			]),
		);
		expect(parsed.relations[0]?.name).toBe("Joshua Tag Howard");
		expect(parsed.relations[0]?.relation).toBe("Spouse");
		// It must not also fall through to the generic "other fields" editor.
		expect(parsed.otherProps.map((p) => p.name)).not.toContain(
			"X-ABRELATEDNAMES",
		);
	});

	it("rewrites a legacy grouped pair as RELATED on save, label and all", () => {
		const existing = vcard([
			prop("VERSION", "4.0"),
			prop("UID", UID),
			prop("FN", "Meghan"),
			prop("item2.X-ABRELATEDNAMES", "Joshua Tag Howard"),
			prop("item2.X-ABLABEL", "_$!<Spouse>!$_"),
		]);
		const merged = mergeFormIntoVcard(
			existing,
			parseVcardToForm(existing),
			UID,
		);
		const names = merged.properties.map((p) => p.name);
		expect(names).not.toContain("item2.X-ABRELATEDNAMES");
		// The orphaned label goes with it rather than dangling.
		expect(names).not.toContain("item2.X-ABLABEL");
		expect(param(relatedProps(merged)[0] as IrProperty, "TYPE")).toBe("spouse");
	});

	it("writes a picked contact as a UID reference carrying its name", () => {
		const relation: ContactRelation = {
			target: { kind: "contact", uid: TARGET_UID },
			name: "Joshua Tag Howard",
			relation: "Spouse",
			preferred: false,
		};
		const built = buildVcardComponent(UID, form({ relations: [relation] }));
		const p = relatedProps(built)[0] as IrProperty;
		expect(getText(p)).toBe(TARGET_UID);
		expect(param(p, "VALUE")).toBe("uri");
		expect(param(p, "X-SKN-RELATION-NAME")).toBe("Joshua Tag Howard");
	});

	it("drops relation rows with nothing to point at", () => {
		const built = buildVcardComponent(
			UID,
			form({
				relations: [
					{
						target: { kind: "text" },
						name: "",
						relation: "Spouse",
						preferred: false,
					},
				],
			}),
		);
		expect(relatedProps(built)).toHaveLength(0);
	});

	it("surfaces a legacy single-property relation form", () => {
		const parsed = parseVcardToForm(
			vcard([
				prop("FN", "Meghan"),
				prop("X-MANAGER", "Dana Boss"),
				prop("AGENT", "Jane Agent"),
			]),
		);
		expect(parsed.relations.map((r) => [r.name, r.relation])).toEqual([
			["Dana Boss", "Manager"],
			["Jane Agent", "Agent"],
		]);
		expect(parsed.otherProps).toEqual([]);
	});

	it("keeps provenance while the wording still means what the source did", () => {
		const existing = vcard([
			prop("VERSION", "4.0"),
			prop("UID", UID),
			prop("FN", "Meghan"),
			prop("RELATED", "Joshua", [
				{ name: "TYPE", value: "spouse" },
				{ name: "X-SKN-RELATION-SOURCE", value: "X-SPOUSE" },
			]),
		]);
		const merged = mergeFormIntoVcard(
			existing,
			parseVcardToForm(existing),
			UID,
		);
		expect(
			param(relatedProps(merged)[0] as IrProperty, "X-SKN-RELATION-SOURCE"),
		).toBe("X-SPOUSE");
	});

	it("drops provenance once the relation is retyped away from it", () => {
		const existing = vcard([
			prop("VERSION", "4.0"),
			prop("UID", UID),
			prop("FN", "Meghan"),
			prop("RELATED", "Joshua", [
				{ name: "TYPE", value: "spouse" },
				{ name: "X-SKN-RELATION-SOURCE", value: "X-SPOUSE" },
			]),
		]);
		const edited = parseVcardToForm(existing);
		const merged = mergeFormIntoVcard(
			existing,
			{
				...edited,
				relations: [
					{ ...(edited.relations[0] as ContactRelation), relation: "Friend" },
				],
			},
			UID,
		);
		const p = relatedProps(merged)[0] as IrProperty;
		expect(param(p, "TYPE")).toBe("friend");
		// Otherwise a friend would downgrade to X-SPOUSE.
		expect(param(p, "X-SKN-RELATION-SOURCE")).toBeUndefined();
	});

	it("survives a parse → merge round-trip unchanged", () => {
		const existing = vcard([
			prop("VERSION", "4.0"),
			prop("UID", UID),
			prop("FN", "Meghan"),
			prop("RELATED", "Jane", [
				{ name: "VALUE", value: "text" },
				{ name: "TYPE", value: "parent" },
				{ name: "X-SKN-RELATION-LABEL", value: "_$!<Mother>!$_" },
			]),
		]);
		const merged = mergeFormIntoVcard(
			existing,
			parseVcardToForm(existing),
			UID,
		);
		const p = relatedProps(merged)[0] as IrProperty;
		expect(getText(p)).toBe("Jane");
		expect(param(p, "TYPE")).toBe("parent");
		expect(param(p, "X-SKN-RELATION-LABEL")).toBe("Mother");
	});
});

describe("photo metadata reconciliation", () => {
	const withPhoto = (photo: string, extra: ReadonlyArray<IrProperty> = []) =>
		vcard([
			prop("VERSION", "4.0"),
			prop("UID", UID),
			prop("FN", "Meghan"),
			{
				name: "PHOTO",
				parameters: [
					{ name: "X-ABCROP-RECTANGLE", value: "ABClipRect_1&1&1&1&1&hash==" },
				],
				value: { type: "URI", value: photo },
				isKnown: true,
			},
			prop("X-IMAGEHASH", "9PrNxogAXek+r+fzx5350A=="),
			prop("X-IMAGETYPE", "PHOTO"),
			prop("X-SHARED-PHOTO-DISPLAY-PREF", "ALWAYS_ASK"),
			...extra,
		]);

	const Old = "data:image/jpeg;base64,AAAA";
	const New = "data:image/jpeg;base64,BBBB";

	it("keeps every companion property while the photo is untouched", () => {
		const existing = withPhoto(Old);
		const merged = mergeFormIntoVcard(
			existing,
			parseVcardToForm(existing),
			UID,
		);
		const names = merged.properties.map((p) => p.name);
		expect(names).toContain("X-IMAGEHASH");
		expect(names).toContain("X-IMAGETYPE");
		expect(names).toContain("X-SHARED-PHOTO-DISPLAY-PREF");
		expect(
			merged.properties.find((p) => p.name === "PHOTO")?.parameters,
		).toHaveLength(1);
	});

	it("drops the stale hash and crop when the photo changes", () => {
		const existing = withPhoto(Old);
		const merged = mergeFormIntoVcard(
			existing,
			{ ...parseVcardToForm(existing), photo: New },
			UID,
		);
		const names = merged.properties.map((p) => p.name);
		expect(names).not.toContain("X-IMAGEHASH");
		expect(
			merged.properties.find((p) => p.name === "PHOTO")?.parameters,
		).toHaveLength(0);
		// The discriminator is one we can restate correctly, so it stays.
		expect(names).toContain("X-IMAGETYPE");
		// Sharing preference is unrelated to the bytes.
		expect(names).toContain("X-SHARED-PHOTO-DISPLAY-PREF");
	});

	it("removes X-IMAGETYPE when the photo is cleared", () => {
		const existing = withPhoto(Old);
		const merged = mergeFormIntoVcard(
			existing,
			{ ...parseVcardToForm(existing), photo: "" },
			UID,
		);
		const names = merged.properties.map((p) => p.name);
		expect(names).not.toContain("PHOTO");
		expect(names).not.toContain("X-IMAGETYPE");
		expect(names).not.toContain("X-IMAGEHASH");
	});

	it("keeps photo companions out of the generic editor", () => {
		const parsed = parseVcardToForm(withPhoto(Old));
		expect(parsed.otherProps.map((p) => p.name)).toEqual([]);
	});
});
