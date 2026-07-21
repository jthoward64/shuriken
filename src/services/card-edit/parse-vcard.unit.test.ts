import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import type { IrComponent, IrProperty } from "#src/data/ir.ts";
import { parseVcardToForm } from "./parse-vcard.ts";

const prop = (
	name: string,
	value: string,
	params: ReadonlyArray<{ name: string; value: string }> = [],
): IrProperty => ({
	name,
	parameters: params,
	value: { type: "TEXT", value },
	isKnown: true,
});

const vcard = (props: ReadonlyArray<IrProperty>): IrComponent => ({
	name: "VCARD",
	properties: props,
	components: [],
});

describe("parseVcardToForm (group-aware)", () => {
	it("reads Apple grouped emails/phones and repeated TYPE tokens", () => {
		const form = parseVcardToForm(
			vcard([
				prop("FN", "Josh"),
				prop("item1.EMAIL", "a@x.com", [
					{ name: "TYPE", value: "INTERNET" },
					{ name: "TYPE", value: "pref" },
				]),
				prop("item2.TEL", "+1 555", [{ name: "TYPE", value: "CELL" }]),
			]),
		);
		expect(form.fn).toBe("Josh");
		// A legacy `TYPE=pref` token folds into `preferred` and is stripped from `types`.
		expect(form.emails).toEqual([
			{ value: "a@x.com", types: ["INTERNET"], preferred: true },
		]);
		expect(form.tels).toEqual([
			{ value: "+1 555", types: ["CELL"], preferred: false },
		]);
	});

	it("splits N into family/given", () => {
		const form = parseVcardToForm(
			vcard([prop("FN", "A"), prop("N", "Smith;John;Q;Dr;Jr")]),
		);
		expect(form.familyName).toBe("Smith");
		expect(form.givenName).toBe("John");
	});
});
