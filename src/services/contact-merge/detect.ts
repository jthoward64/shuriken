import { normalizeEmail, normalizeName, normalizePhone } from "./normalize.ts";

// ---------------------------------------------------------------------------
// Duplicate detection — pure grouping over contact projections.
//
// Two contacts belong to the same duplicate group if they share ANY normalized
// match key from ANY selected criterion (OR semantics): a shared phone alone is
// enough, even when the names differ. Grouping is transitive — A~B and B~C put
// A, B and C in one group — implemented with a union-find over the contacts.
// ---------------------------------------------------------------------------

/** A field the user can choose to match duplicates on. */
export type MatchCriterion = "email" | "phone" | "name";

/**
 * The minimal contact projection detection needs. Mirrors
 * `DedupCardRow` from the card-index repository, but kept independent so this
 * module stays pure and free of DB types.
 */
export interface DetectContact {
	readonly instanceId: string;
	readonly fn: string | null;
	readonly emails: ReadonlyArray<string>;
	readonly phones: ReadonlyArray<string>;
}

/** Every normalized match key a contact contributes for the given criteria. */
const contactKeys = (
	contact: DetectContact,
	criteria: ReadonlyArray<MatchCriterion>,
): ReadonlyArray<string> => {
	const keys: Array<string> = [];
	if (criteria.includes("email")) {
		for (const email of contact.emails) {
			const n = normalizeEmail(email);
			if (n !== "") {
				keys.push(`email:${n}`);
			}
		}
	}
	if (criteria.includes("phone")) {
		for (const phone of contact.phones) {
			const n = normalizePhone(phone);
			if (n !== "") {
				keys.push(`phone:${n}`);
			}
		}
	}
	if (criteria.includes("name")) {
		const n = normalizeName(contact.fn ?? "");
		if (n !== "") {
			keys.push(`name:${n}`);
		}
	}
	return keys;
};

/**
 * Partition `contacts` into duplicate groups. Only groups with two or more
 * members are returned; a contact matching nothing is omitted. Group order
 * follows first appearance in `contacts`, and members within a group keep their
 * original relative order, so results are stable for a stable input.
 */
export const findDuplicateGroups = <T extends DetectContact>(
	contacts: ReadonlyArray<T>,
	criteria: ReadonlyArray<MatchCriterion>,
): ReadonlyArray<ReadonlyArray<T>> => {
	if (criteria.length === 0 || contacts.length === 0) {
		return [];
	}

	// Union-find over contact indices. `?? p` reads are only there to satisfy
	// noUncheckedIndexedAccess — every index is in range by construction.
	const parent = contacts.map((_, i) => i);
	const find = (x: number): number => {
		let root = x;
		for (let p = parent[root] ?? root; p !== root; p = parent[root] ?? root) {
			parent[root] = parent[p] ?? p;
			root = p;
		}
		return root;
	};
	const union = (a: number, b: number): void => {
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) {
			parent[ra] = rb;
		}
	};

	// First contact seen for each key; subsequent holders union with it.
	const keyOwner = new Map<string, number>();
	contacts.forEach((contact, i) => {
		for (const key of contactKeys(contact, criteria)) {
			const owner = keyOwner.get(key);
			if (owner === undefined) {
				keyOwner.set(key, i);
			} else {
				union(owner, i);
			}
		}
	});

	// Collect members per root, preserving first-appearance order of both the
	// groups and the members within them.
	const groups = new Map<number, Array<T>>();
	contacts.forEach((contact, i) => {
		const root = find(i);
		const existing = groups.get(root);
		if (existing === undefined) {
			groups.set(root, [contact]);
		} else {
			existing.push(contact);
		}
	});

	return [...groups.values()].filter((members) => members.length >= 2);
};
