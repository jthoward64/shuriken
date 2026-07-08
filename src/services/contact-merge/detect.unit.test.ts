import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import {
	type DetectContact,
	findDuplicateGroups,
	type MatchCriterion,
} from "./detect.ts";
import { normalizeEmail, normalizeName, normalizePhone } from "./normalize.ts";

const contact = (
	instanceId: string,
	fn: string | null,
	emails: ReadonlyArray<string>,
	phones: ReadonlyArray<string>,
): DetectContact => ({ instanceId, fn, emails, phones });

const ids = (groups: ReadonlyArray<ReadonlyArray<DetectContact>>) =>
	groups.map((g) => g.map((c) => c.instanceId).sort());

describe("normalize", () => {
	it("lowercases and trims email", () => {
		expect(normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
	});

	it("reduces a phone to its digits, dropping all formatting and +", () => {
		expect(normalizePhone("+1 (555) 123-4567")).toBe("15551234567");
		expect(normalizePhone("555.123.4567")).toBe("5551234567");
		expect(normalizePhone("n/a")).toBe("");
	});

	it("collapses whitespace and case in names", () => {
		expect(normalizeName("  John   Doe ")).toBe("john doe");
	});
});

describe("findDuplicateGroups", () => {
	it("returns nothing when no criteria are selected", () => {
		const a = contact("a", "A", ["x@y.com"], []);
		const b = contact("b", "B", ["x@y.com"], []);
		expect(findDuplicateGroups([a, b], [])).toEqual([]);
	});

	it("matches on shared email even when names differ", () => {
		const a = contact("a", "Jon", ["shared@x.com"], []);
		const b = contact("b", "Jonathan", ["shared@x.com"], []);
		const groups = findDuplicateGroups([a, b], ["email"]);
		expect(ids(groups)).toEqual([["a", "b"]]);
	});

	it("uses OR semantics across criteria (same phone, different name matches)", () => {
		const a = contact("a", "Alice", ["a@x.com"], ["+1 555 0000"]);
		const b = contact("b", "Alicia", ["b@x.com"], ["1-555-0000"]);
		const groups = findDuplicateGroups([a, b], ["email", "phone", "name"]);
		expect(ids(groups)).toEqual([["a", "b"]]);
	});

	it("does not match when the only shared field is not a selected criterion", () => {
		// Same name, but matching only by phone/email.
		const a = contact("a", "Same Name", ["a@x.com"], ["111"]);
		const b = contact("b", "Same Name", ["b@x.com"], ["222"]);
		expect(findDuplicateGroups([a, b], ["email", "phone"])).toEqual([]);
	});

	it("groups transitively: A~B by phone, B~C by email", () => {
		const a = contact("a", "A", [], ["+1 555 0001"]);
		const b = contact("b", "B", ["link@x.com"], ["1-555-0001"]);
		const c = contact("c", "C", ["link@x.com"], []);
		const groups = findDuplicateGroups([a, b, c], ["email", "phone"]);
		expect(ids(groups)).toEqual([["a", "b", "c"]]);
	});

	it("keeps distinct contacts in separate groups and omits singletons", () => {
		const a = contact("a", "A", ["dup@x.com"], []);
		const b = contact("b", "B", ["dup@x.com"], []);
		const lonely = contact("c", "C", ["unique@x.com"], []);
		const groups = findDuplicateGroups([a, b, lonely], ["email"]);
		expect(ids(groups)).toEqual([["a", "b"]]);
	});

	it("ignores empty/whitespace values", () => {
		const a = contact("a", "  ", ["  "], ["   "]);
		const b = contact("b", "", [""], [""]);
		const criteria: ReadonlyArray<MatchCriterion> = ["email", "phone", "name"];
		expect(findDuplicateGroups([a, b], criteria)).toEqual([]);
	});
});
