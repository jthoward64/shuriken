import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import {
	type CollectionSortKind,
	computeReorder,
	type SortableCollection,
} from "./sort-order.ts";

// Ids are creation-ordered: "cal1" < "cal2" < ... lexicographically, mirroring
// uuidv7 chronological ordering.
const KIND: Readonly<Record<string, CollectionSortKind>> = {
	cal1: "normal",
	cal2: "normal",
	cal3: "subscribed",
	cal4: "subscribed",
	cal5: "generated",
};

/** Build the collection list in a given order from an id -> sortOrder map. */
const state = (
	order: ReadonlyArray<string>,
	sortOrders: Readonly<Record<string, number>>,
): ReadonlyArray<SortableCollection> =>
	order.map((id) => ({
		id,
		kind: KIND[id] ?? "normal",
		sortOrder: sortOrders[id] ?? 0,
	}));

/** Apply the computed changes on top of the prior sortOrders to get the full result. */
const apply = (
	prior: Readonly<Record<string, number>>,
	changes: ReadonlyMap<string, number>,
): Record<string, number> => {
	const next: Record<string, number> = { ...prior };
	for (const [id, value] of changes) {
		next[id] = value;
	}
	return next;
};

describe("computeReorder", () => {
	it("example 1: drag cal3 below cal4 (dragged down) bumps only cal3", () => {
		const prior = { cal1: -1000, cal2: -1000, cal3: 0, cal4: 0, cal5: 1000 };
		const desired = state(["cal1", "cal2", "cal4", "cal3", "cal5"], prior);
		const changes = computeReorder(desired, "cal3");
		expect(Object.fromEntries(changes)).toEqual({ cal3: 1 });
		expect(apply(prior, changes)).toEqual({
			cal1: -1000,
			cal2: -1000,
			cal4: 0,
			cal3: 1,
			cal5: 1000,
		});
	});

	it("example 2: drag cal5 above cal2 (dragged up) makes room by pushing down", () => {
		const prior = { cal1: -1000, cal2: -1000, cal4: 0, cal3: 1, cal5: 1000 };
		const desired = state(["cal1", "cal5", "cal2", "cal4", "cal3"], prior);
		const changes = computeReorder(desired, "cal5");
		expect(Object.fromEntries(changes)).toEqual({ cal5: -1001, cal1: -1002 });
		expect(apply(prior, changes)).toEqual({
			cal1: -1002,
			cal5: -1001,
			cal2: -1000,
			cal4: 0,
			cal3: 1,
		});
	});

	it("example 3: drag cal5 back to the bottom relaxes cal1 to its default", () => {
		const prior = { cal1: -1002, cal5: -1001, cal2: -1000, cal4: 0, cal3: 1 };
		const desired = state(["cal1", "cal2", "cal4", "cal3", "cal5"], prior);
		const changes = computeReorder(desired, "cal5");
		expect(Object.fromEntries(changes)).toEqual({ cal1: -1000, cal5: 1000 });
		expect(apply(prior, changes)).toEqual({
			cal1: -1000,
			cal2: -1000,
			cal4: 0,
			cal3: 1,
			cal5: 1000,
		});
	});

	it("returns no changes when the desired order matches the current order", () => {
		const prior = { cal1: -1000, cal2: -1000, cal3: 0, cal4: 0, cal5: 1000 };
		const desired = state(["cal1", "cal2", "cal3", "cal4", "cal5"], prior);
		expect(computeReorder(desired, "cal3").size).toBe(0);
	});

	it("result always sorts to the desired order (property check)", () => {
		const prior = { cal1: -1002, cal5: -1001, cal2: -1000, cal4: 0, cal3: 1 };
		const order = ["cal2", "cal1", "cal5", "cal3", "cal4"];
		const desired = state(order, prior);
		const result = apply(prior, computeReorder(desired, "cal1"));
		const sorted = [...order].sort((a, b) =>
			result[a] !== result[b]
				? (result[a] ?? 0) - (result[b] ?? 0)
				: a < b
					? -1
					: 1,
		);
		expect(sorted).toEqual(order);
	});
});
