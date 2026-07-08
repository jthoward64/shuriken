import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { InstanceId } from "#src/domain/ids.ts";
import {
	removeDuplicateFix,
	setNameCaseFix,
} from "#src/services/contact-cleanup/types.ts";
import { buildFixGroups } from "./cleanup-fix-all.tsx";

// ---------------------------------------------------------------------------
// buildFixGroups — filters out suggestions that need extra user input, groups
// the rest by contact, and orders each contact's fixes highest-occurrence-
// first so a removal never invalidates a not-yet-applied lower-occurrence fix
// on the same property (see cleanup-fix-all.tsx for the full rationale).
// ---------------------------------------------------------------------------

const dup = (occurrence: number, value: string) =>
	removeDuplicateFix("EMAIL", occurrence, value);

const nameCase = setNameCaseFix("FN", "bob", "Bob");

describe("buildFixGroups", () => {
	it("drops suggestions that need extra input", () => {
		const a = InstanceId(crypto.randomUUID());
		const groups = buildFixGroups([
			{ instanceId: a, fix: dup(0, "a@x.com"), needsInput: "areaCode" },
		]);
		expect(groups).toEqual([]);
	});

	it("groups fixes by contact and sorts each group highest-occurrence-first", () => {
		const a = InstanceId(crypto.randomUUID());
		const b = InstanceId(crypto.randomUUID());
		const groups = buildFixGroups([
			{ instanceId: a, fix: dup(0, "a1@x.com") },
			{ instanceId: a, fix: dup(2, "a2@x.com") },
			{ instanceId: a, fix: dup(1, "a3@x.com") },
			{ instanceId: b, fix: nameCase },
		]);

		expect(groups).toHaveLength(2);
		const groupA = groups.find((g) => g.instanceId === a);
		const groupB = groups.find((g) => g.instanceId === b);

		expect(
			groupA?.fixes.map((f) => (f as { occurrence: number }).occurrence),
		).toEqual([2, 1, 0]);
		expect(groupB?.fixes).toEqual([nameCase]);
	});
});
