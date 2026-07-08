import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import {
	isAllLower,
	isAllUpper,
	looksMiscased,
	smartNameCase,
	smartStructuredNameCase,
} from "./name-case.ts";

describe("smartNameCase", () => {
	const cases: ReadonlyArray<readonly [string, string]> = [
		["MCDONALD", "McDonald"],
		["mcdonald", "McDonald"],
		["o'hare", "O'Hare"],
		["D'ANGELO", "D'Angelo"],
		["mary-jane", "Mary-Jane"],
		["VAN DER BERG", "van der Berg"],
		["JOHN SMITH III", "John Smith III"],
		["jane doe jr", "Jane Doe Jr"],
		["MACKENZIE", "MacKenzie"],
		["mack", "Mack"],
		["macey", "Macey"],
	];
	for (const [input, expected] of cases) {
		it(`cases "${input}" -> "${expected}"`, () => {
			expect(smartNameCase(input)).toBe(expected);
		});
	}
});

describe("smartStructuredNameCase", () => {
	it("cases each N component independently and preserves structure", () => {
		expect(smartStructuredNameCase("MCDONALD;john;;;")).toBe(
			"McDonald;John;;;",
		);
	});
});

describe("miscase detectors", () => {
	it("flags all-upper and all-lower", () => {
		expect(isAllUpper("SMITH")).toBe(true);
		expect(isAllLower("smith")).toBe(true);
		expect(looksMiscased("SMITH")).toBe(true);
		expect(looksMiscased("smith")).toBe(true);
	});

	it("ignores already mixed-case and letterless values", () => {
		expect(looksMiscased("McDonald")).toBe(false);
		expect(looksMiscased("O'Hare")).toBe(false);
		expect(isAllUpper("123")).toBe(false);
		expect(isAllLower("123")).toBe(false);
	});
});
