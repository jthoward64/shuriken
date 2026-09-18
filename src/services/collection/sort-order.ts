// ---------------------------------------------------------------------------
// Collection sort-order algorithm (pure, no Effect / DB dependencies)
//
// DAV collections are ordered by the sort key (sortOrder ASC, id ASC). Ids are
// creation-ordered uuidv7 values, so lexicographic id comparison is chronological
// — i.e. ties in sortOrder fall back to "oldest first". Each collection has a
// type-default sortOrder:
//
//   normal      = -1000   (user-created calendars / address books)
//   subscribed  =     0   (external subscription calendars)
//   generated   =  1000   (server-managed, e.g. birthdays)
//
// A drag-and-drop reorder moves a single item M to a new slot. We make the
// MINIMAL change needed to realise the user's order while keeping values at
// their type-defaults wherever the natural (creation-date) order already
// suffices. Two steps:
//
//   1. Local edit — place M between its new predecessor P and successor N. If
//      M's default already fits, use it. Otherwise anchor on the far side and
//      cascade neighbours with strict ±1 gaps in the drag direction.
//   2. Snap-to-default — reset any collection to *exactly* its type-default when
//      that still preserves the order. Never relax partway. This pulls values
//      home once items vacate the space that forced them off-default.
//
// The result is intentionally history-dependent: dragging Cal A below Cal B and
// dragging Cal B above Cal A can yield different (both valid) assignments, so
// callers pass the moved id alongside the desired order.
// ---------------------------------------------------------------------------

export type CollectionSortKind = "normal" | "subscribed" | "generated";

export const DEFAULT_SORT_ORDER: Readonly<Record<CollectionSortKind, number>> =
	{
		normal: -1000,
		subscribed: 0,
		generated: 1000,
	};

export const defaultSortOrder = (kind: CollectionSortKind): number =>
	DEFAULT_SORT_ORDER[kind];

export interface SortableCollection {
	/** Creation-ordered uuid; lexicographic compare == chronological order. */
	readonly id: string;
	readonly kind: CollectionSortKind;
	/** Current stored sortOrder. */
	readonly sortOrder: number;
}

/** True iff (aSort, aId) sorts strictly before (bSort, bId). */
const before = (
	aSort: number,
	aId: string,
	bSort: number,
	bId: string,
): boolean => aSort < bSort || (aSort === bSort && aId < bId);

/** The working state of one reorder pass. */
interface ReorderCtx {
	readonly desired: ReadonlyArray<SortableCollection>;
	readonly n: number;
	/** Current working sortOrder per id. */
	readonly so: Map<string, number>;
	readonly idAt: (i: number) => string;
	readonly soOf: (id: string) => number;
	readonly dfltOf: (id: string) => number;
}

const makeCtx = (desired: ReadonlyArray<SortableCollection>): ReorderCtx => {
	const so = new Map<string, number>(desired.map((c) => [c.id, c.sortOrder]));
	const kindOf = new Map<string, CollectionSortKind>(
		desired.map((c) => [c.id, c.kind]),
	);
	return {
		desired,
		n: desired.length,
		so,
		idAt: (i) => {
			const c = desired[i];
			if (c === undefined) {
				throw new Error("index out of range");
			}
			return c.id;
		},
		soOf: (id) => so.get(id) ?? 0,
		dfltOf: (id) => DEFAULT_SORT_ORDER[kindOf.get(id) ?? "normal"],
	};
};

/**
 * Step 1 — place the moved item between its new neighbours, cascading the
 * items on the far side with strict ±1 gaps when its type-default cannot fit.
 */
const placeMoved = (
	ctx: ReorderCtx,
	idx: number,
	movedId: string,
	draggedDown: boolean,
): void => {
	const { n, so, idAt, soOf, dfltOf } = ctx;
	const P = idx > 0 ? idAt(idx - 1) : null;
	const N = idx < n - 1 ? idAt(idx + 1) : null;
	const dM = dfltOf(movedId);

	const okAboveP = P === null || before(soOf(P), P, dM, movedId);
	const okBelowN = N === null || before(dM, movedId, soOf(N), N);

	if (okAboveP && okBelowN) {
		// M's type-default already slots in cleanly.
		so.set(movedId, dM);
		return;
	}
	if (draggedDown) {
		// Anchor on P (guaranteed non-null when dragged down): place M minimally
		// above P, tie on creation order where possible, then push N and below up
		// with strict +1 gaps until the order holds.
		const pSo = soOf(P as string);
		so.set(movedId, movedId > (P as string) ? pSo : pSo + 1);
		for (let j = idx + 1; j < n; j++) {
			const prev = idAt(j - 1);
			const cur = idAt(j);
			if (before(soOf(prev), prev, soOf(cur), cur)) {
				break;
			}
			so.set(cur, soOf(prev) + 1);
		}
		return;
	}
	// Dragged up. Anchor on N (guaranteed non-null): place M minimally below
	// N, then push P and above down with strict -1 gaps.
	const nSo = soOf(N as string);
	so.set(movedId, movedId < (N as string) ? nSo : nSo - 1);
	for (let j = idx - 1; j >= 0; j--) {
		const cur = idAt(j);
		const below = idAt(j + 1);
		if (before(soOf(cur), cur, soOf(below), below)) {
			break;
		}
		so.set(cur, soOf(below) - 1);
	}
};

/**
 * Step 2 — reset any collection to exactly its type-default when that keeps the
 * order valid. Looped to a fixpoint since one snap can unblock another.
 */
const snapToDefaults = (ctx: ReorderCtx): void => {
	const { n, so, idAt, soOf, dfltOf } = ctx;
	let changed = true;
	while (changed) {
		changed = false;
		for (let i = 0; i < n; i++) {
			const id = idAt(i);
			const d = dfltOf(id);
			if (soOf(id) === d) {
				continue;
			}
			const above = i === 0 || before(soOf(idAt(i - 1)), idAt(i - 1), d, id);
			const below =
				i === n - 1 || before(d, id, soOf(idAt(i + 1)), idAt(i + 1));
			if (above && below) {
				so.set(id, d);
				changed = true;
			}
		}
	}
};

/** True when every consecutive pair of the desired order sorts correctly. */
const isStrictlyOrdered = (ctx: ReorderCtx): boolean => {
	for (let i = 1; i < ctx.n; i++) {
		const prev = ctx.idAt(i - 1);
		const cur = ctx.idAt(i);
		if (!before(ctx.soOf(prev), prev, ctx.soOf(cur), cur)) {
			return false;
		}
	}
	return true;
};

/** Only the collections whose working sortOrder differs from the stored one. */
const changedOrders = (ctx: ReorderCtx): ReadonlyMap<string, number> => {
	const changes = new Map<string, number>();
	for (const c of ctx.desired) {
		const next = ctx.soOf(c.id);
		if (next !== c.sortOrder) {
			changes.set(c.id, next);
		}
	}
	return changes;
};

/** The index the moved item currently occupies in the stored order. */
const currentIndexOf = (
	desired: ReadonlyArray<SortableCollection>,
	movedId: string,
): number =>
	[...desired]
		.sort((a, b) => (before(a.sortOrder, a.id, b.sortOrder, b.id) ? -1 : 1))
		.findIndex((c) => c.id === movedId);

/**
 * Compute the minimal set of sortOrder changes to realise `desired` (the target
 * top-to-bottom order) given that `movedId` is the item the user dragged.
 *
 * Returns a map of collection id -> new sortOrder containing ONLY the
 * collections whose value actually changed (often just one). An empty map means
 * no change is needed.
 */
export const computeReorder = (
	desired: ReadonlyArray<SortableCollection>,
	movedId: string,
): ReadonlyMap<string, number> => {
	const idx = desired.findIndex((c) => c.id === movedId);
	if (idx < 0 || desired.length === 0) {
		return new Map();
	}
	// Direction of the drag: compare M's position in the current stored order
	// against its position in the desired order.
	const curIdx = currentIndexOf(desired, movedId);
	if (idx === curIdx) {
		return new Map();
	}

	const ctx = makeCtx(desired);
	placeMoved(ctx, idx, movedId, idx > curIdx);
	snapToDefaults(ctx);

	// Safety net: for a single drag from a valid state the steps above always
	// realise the order, but guard against unexpected input (e.g. a multi-item
	// move) by rebuilding strictly if any consecutive pair is out of order.
	return isStrictlyOrdered(ctx)
		? changedOrders(ctx)
		: rebuildStrict(desired, ctx.dfltOf);
};

/** Fallback: assign values forward so `desired` is guaranteed to sort correctly,
 * staying at type-defaults where the running maximum allows. */
const rebuildStrict = (
	desired: ReadonlyArray<SortableCollection>,
	dfltOf: (id: string) => number,
): ReadonlyMap<string, number> => {
	const changes = new Map<string, number>();
	let prevId: string | null = null;
	let prevSo = 0;
	for (const c of desired) {
		let value = dfltOf(c.id);
		if (prevId !== null) {
			const minimal = c.id > prevId ? prevSo : prevSo + 1;
			if (value < minimal) {
				value = minimal;
			}
		}
		if (value !== c.sortOrder) {
			changes.set(c.id, value);
		}
		prevId = c.id;
		prevSo = value;
	}
	return changes;
};
