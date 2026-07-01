/** biome-ignore-all lint/style/useNamingConvention: tagged-union discriminants use _tag */
import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Result } from "effect";
import type { IrComponent, IrParameter, IrProperty } from "#src/data/ir.ts";
import { applyFix } from "./apply-fix.ts";
import { getText, getTypeValue } from "./fields.ts";
import type { CleanupFix } from "./types.ts";

const prop = (
	name: string,
	value: string,
	parameters: ReadonlyArray<IrParameter> = [],
): IrProperty => ({
	name,
	parameters,
	value: { type: "TEXT", value },
	isKnown: true,
});

const vcard = (props: ReadonlyArray<IrProperty>): IrComponent => ({
	name: "VCARD",
	properties: [prop("VERSION", "4.0"), ...props],
	components: [],
});

const apply = (v: IrComponent, fix: CleanupFix): IrComponent => {
	const r = applyFix(v, fix);
	if (Result.isFailure(r)) {
		throw new Error(`expected success: ${r.failure.reason}`);
	}
	return r.success;
};

const emails = (v: IrComponent) =>
	v.properties.filter((p) => p.name === "EMAIL");

describe("applyFix", () => {
	it("SetPhone replaces the target TEL value", () => {
		const out = apply(vcard([prop("TEL", "555")]), {
			_tag: "SetPhone",
			occurrence: 0,
			current: "555",
			next: "+14155552671",
		});
		expect(getText(out.properties.find((p) => p.name === "TEL"))).toBe(
			"+14155552671",
		);
	});

	it("LowercaseEmail rewrites the addressed occurrence only", () => {
		const out = apply(
			vcard([prop("EMAIL", "a@x.com"), prop("EMAIL", "B@X.COM")]),
			{
				_tag: "LowercaseEmail",
				occurrence: 1,
				current: "B@X.COM",
				next: "b@x.com",
			},
		);
		expect(emails(out).map((p) => getText(p))).toEqual(["a@x.com", "b@x.com"]);
	});

	it("SetNameCase updates N", () => {
		const out = apply(vcard([prop("N", "MCDONALD;john;;;")]), {
			_tag: "SetNameCase",
			field: "N",
			current: "MCDONALD;john;;;",
			next: "McDonald;John;;;",
		});
		expect(getText(out.properties.find((p) => p.name === "N"))).toBe(
			"McDonald;John;;;",
		);
	});

	it("RemoveDuplicate drops the target property", () => {
		const out = apply(
			vcard([prop("EMAIL", "a@x.com"), prop("EMAIL", "a@x.com")]),
			{
				_tag: "RemoveDuplicate",
				propName: "EMAIL",
				occurrence: 1,
				value: "a@x.com",
			},
		);
		expect(emails(out).length).toBe(1);
	});

	it("SetLabel sets a TYPE parameter", () => {
		const out = apply(
			vcard([prop("EMAIL", "a@x.com", [{ name: "TYPE", value: "VALUE" }])]),
			{
				_tag: "SetLabel",
				propName: "EMAIL",
				occurrence: 0,
				current: "VALUE",
				newType: "home",
			},
		);
		const e = emails(out)[0];
		expect(e && getTypeValue(e)).toBe("home");
	});

	it("SetLabel with null removes the TYPE parameter", () => {
		const out = apply(
			vcard([prop("EMAIL", "a@x.com", [{ name: "TYPE", value: "other" }])]),
			{
				_tag: "SetLabel",
				propName: "EMAIL",
				occurrence: 0,
				current: "other",
				newType: null,
			},
		);
		const e = emails(out)[0];
		expect(e && getTypeValue(e)).toBe("");
	});

	it("preserves unrelated properties", () => {
		const out = apply(
			vcard([prop("EMAIL", "A@X.COM"), prop("NICKNAME", "Ace")]),
			{
				_tag: "LowercaseEmail",
				occurrence: 0,
				current: "A@X.COM",
				next: "a@x.com",
			},
		);
		expect(getText(out.properties.find((p) => p.name === "NICKNAME"))).toBe(
			"Ace",
		);
	});

	it("fails stale when the current value no longer matches", () => {
		const r = applyFix(vcard([prop("EMAIL", "changed@x.com")]), {
			_tag: "LowercaseEmail",
			occurrence: 0,
			current: "A@X.COM",
			next: "a@x.com",
		});
		expect(Result.isFailure(r)).toBe(true);
	});

	it("fails stale when the property is gone", () => {
		const r = applyFix(vcard([]), {
			_tag: "SetPhone",
			occurrence: 0,
			current: "555",
			next: "+1",
		});
		expect(Result.isFailure(r)).toBe(true);
	});
});
