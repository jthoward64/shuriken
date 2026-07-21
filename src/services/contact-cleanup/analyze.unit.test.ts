/** biome-ignore-all lint/style/useNamingConvention: tagged-union discriminants use _tag */
import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import type { IrComponent, IrParameter, IrProperty } from "#src/data/ir.ts";
import { InstanceId } from "#src/domain/ids.ts";
import { analyzeCard } from "./analyze.ts";
import { analyzeDuplicates } from "./analyze-duplicates.ts";
import { analyzeEmails } from "./analyze-email.ts";
import { analyzeLabels } from "./analyze-labels.ts";
import { analyzeNames } from "./analyze-name.ts";
import { analyzePhones } from "./analyze-phone.ts";

const REGION = "US";

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

const typed = (name: string, value: string, type: string): IrProperty =>
	prop(name, value, [{ name: "TYPE", value: type }]);

const vcard = (props: ReadonlyArray<IrProperty>): IrComponent => ({
	name: "VCARD",
	properties: [prop("VERSION", "4.0"), ...props],
	components: [],
});

describe("analyzeEmails", () => {
	it("suggests lowercasing an email with uppercase", () => {
		const out = analyzeEmails(vcard([prop("EMAIL", "John@X.COM")]));
		expect(out.length).toBe(1);
		expect(out[0]?.category).toBe("email");
		expect(out[0]?.proposed).toBe("john@x.com");
		expect(out[0]?.fix).toEqual({
			_tag: "LowercaseEmail",
			occurrence: 0,
			current: "John@X.COM",
			next: "john@x.com",
		});
	});

	it("ignores an already-lowercase email", () => {
		expect(analyzeEmails(vcard([prop("EMAIL", "a@x.com")])).length).toBe(0);
	});
});

describe("analyzePhones", () => {
	it("reformats a valid number to E.164", () => {
		const out = analyzePhones(vcard([prop("TEL", "(415) 555-2671")]), REGION);
		expect(out.length).toBe(1);
		expect(out[0]?.proposed).toBe("+14155552671");
		expect(out[0]?.needsInput).toBeUndefined();
	});

	it("flags a number missing its area code", () => {
		const out = analyzePhones(vcard([prop("TEL", "555-1234")]), REGION);
		expect(out.length).toBe(1);
		expect(out[0]?.needsInput).toBe("areaCode");
		expect(out[0]?.region).toBe(REGION);
	});

	it("ignores a number too short to be missing only an area code", () => {
		expect(analyzePhones(vcard([prop("TEL", "732873")]), REGION).length).toBe(
			0,
		);
	});

	it("leaves an already-canonical number alone", () => {
		expect(
			analyzePhones(vcard([prop("TEL", "+14155552671")]), REGION).length,
		).toBe(0);
	});
});

describe("analyzeNames", () => {
	it("suggests case correction for an all-caps FN", () => {
		const out = analyzeNames(vcard([prop("FN", "MCDONALD")]));
		expect(out.length).toBe(1);
		expect(out[0]?.proposed).toBe("McDonald");
		expect(out[0]?.fix).toEqual({
			_tag: "SetNameCase",
			field: "FN",
			current: "MCDONALD",
			next: "McDonald",
		});
	});

	it("suggests case correction for a structured N", () => {
		const out = analyzeNames(vcard([prop("N", "MCDONALD;JOHN;;;")]));
		expect(out[0]?.fix).toMatchObject({
			_tag: "SetNameCase",
			field: "N",
			next: "McDonald;John;;;",
		});
	});

	it("ignores a mixed-case name", () => {
		expect(analyzeNames(vcard([prop("FN", "McDonald")])).length).toBe(0);
	});
});

describe("analyzeDuplicates", () => {
	it("flags the later of two equal emails", () => {
		const out = analyzeDuplicates(
			vcard([prop("EMAIL", "a@x.com"), prop("EMAIL", "A@X.COM")]),
			REGION,
		);
		expect(out.length).toBe(1);
		expect(out[0]?.fix).toEqual({
			_tag: "RemoveDuplicate",
			propName: "EMAIL",
			occurrence: 1,
			value: "A@X.COM",
		});
	});

	it("compares phones by digits only", () => {
		const out = analyzeDuplicates(
			vcard([prop("TEL", "+1 415 555 2671"), prop("TEL", "(415) 555-2671")]),
			REGION,
		);
		expect(out.length).toBe(1);
		expect(out[0]?.fix).toMatchObject({
			_tag: "RemoveDuplicate",
			occurrence: 1,
		});
	});
});

describe("analyzeLabels", () => {
	it("flags a bogus VALUE label", () => {
		const out = analyzeLabels(vcard([typed("EMAIL", "a@x.com", "VALUE")]));
		expect(out.length).toBe(1);
		expect(out[0]?.needsInput).toBe("label");
		expect(out[0]?.fix).toMatchObject({ _tag: "SetLabel", current: "VALUE" });
	});

	it("flags 'other' only when it is the sole entry", () => {
		expect(
			analyzeLabels(vcard([typed("EMAIL", "a@x.com", "other")])).length,
		).toBe(1);
		expect(
			analyzeLabels(
				vcard([
					typed("EMAIL", "a@x.com", "other"),
					typed("EMAIL", "b@x.com", "home"),
				]),
			).length,
		).toBe(0);
	});

	it("flags a junk Apple X-ABLABEL and offers to remove it", () => {
		const out = analyzeLabels(
			vcard([prop("item1.EMAIL", "a@x.com"), prop("item1.X-ABLABEL", "VALUE")]),
		);
		expect(out.length).toBe(1);
		expect(out[0]?.fix).toMatchObject({
			_tag: "SetAbLabel",
			occurrence: 0,
			current: "VALUE",
			newLabel: null,
		});
	});

	it("leaves Apple wrapped built-ins and genuine custom labels alone", () => {
		expect(
			analyzeLabels(
				vcard([
					prop("item1.EMAIL", "a@x.com"),
					prop("item1.X-ABLABEL", "_$!<Other>!$_"),
				]),
			).length,
		).toBe(0);
		expect(
			analyzeLabels(
				vcard([
					prop("item2.URL", "https://tiktok.com/@x"),
					prop("item2.X-ABLABEL", "TikTok"),
				]),
			).length,
		).toBe(0);
	});
});

describe("grouped (Apple) properties", () => {
	it("email/phone analyzers see item1.EMAIL and repeated TYPE", () => {
		const emailOut = analyzeEmails(vcard([prop("item1.EMAIL", "John@X.COM")]));
		expect(emailOut.length).toBe(1);
		expect(emailOut[0]?.proposed).toBe("john@x.com");

		const telProp: IrProperty = {
			name: "item1.TEL",
			parameters: [
				{ name: "TYPE", value: "CELL" },
				{ name: "TYPE", value: "VOICE" },
			],
			value: { type: "TEXT", value: "(415) 555-2671" },
			isKnown: true,
		};
		const phoneOut = analyzePhones(vcard([telProp]), REGION);
		expect(phoneOut[0]?.proposed).toBe("+14155552671");
	});
});

describe("analyzeCard", () => {
	it("stamps identity and finds problems across categories", () => {
		const id = InstanceId("11111111-1111-1111-1111-111111111111");
		const out = analyzeCard(
			vcard([
				prop("FN", "MCDONALD"),
				prop("EMAIL", "John@X.COM"),
				typed("TEL", "555-1234", "VALUE"),
			]),
			id,
			REGION,
		);
		expect(out.length).toBeGreaterThanOrEqual(3);
		for (const s of out) {
			expect(s.instanceId).toBe(id);
			expect(s.contactFn).toBe("MCDONALD");
			expect(s.id.startsWith(id)).toBe(true);
		}
	});
});
