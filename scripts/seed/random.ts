// ---------------------------------------------------------------------------
// Small randomness helpers shared across the seed generators. Kept separate
// from faker so callers can see at a glance what's project-specific vs.
// faker-provided.
// ---------------------------------------------------------------------------

export const intBetween = (min: number, max: number): number => {
	if (max <= min) {
		return min;
	}
	return min + Math.floor(Math.random() * (max - min + 1));
};

export const pick = <T>(items: ReadonlyArray<T>): T => {
	const item = items[intBetween(0, items.length - 1)];
	if (item === undefined) {
		throw new Error("pick: called with an empty array");
	}
	return item;
};

export const chance = (probability: number): boolean =>
	Math.random() < probability;

/** Fisher-Yates shuffle — does not mutate the input. */
export const shuffled = <T>(items: ReadonlyArray<T>): Array<T> => {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = intBetween(0, i);
		const a = copy[i] as T;
		const b = copy[j] as T;
		copy[i] = b;
		copy[j] = a;
	}
	return copy;
};

/** Sample `count` distinct items (count is clamped to the pool size). */
export const sampleDistinct = <T>(
	items: ReadonlyArray<T>,
	count: number,
): Array<T> => shuffled(items).slice(0, Math.min(count, items.length));

/**
 * Split `total` into `parts` positive-ish integers summing to `total`, with
 * randomized weights so no part is starved when `total` is comfortably
 * larger than `parts`. Every part gets at least `Math.floor(total / parts /
 * 4)` before the remainder is distributed by weight, so small totals still
 * spread out rather than dumping everything on one part.
 */
export const weightedSplit = (total: number, parts: number): Array<number> => {
	if (parts <= 0) {
		return [];
	}
	if (parts === 1) {
		return [total];
	}
	// Floor so even the unluckiest random draw still gets a meaningful share.
	const minWeight = 0.1;
	const weights = Array.from(
		{ length: parts },
		() => Math.random() + minWeight,
	);
	const weightSum = weights.reduce((a, b) => a + b, 0);
	const result = weights.map((w) => Math.floor((w / weightSum) * total));
	const assigned = result.reduce((a, b) => a + b, 0);
	// Hand out the rounding remainder one-by-one so the total matches exactly.
	let remainder = total - assigned;
	let i = 0;
	while (remainder > 0) {
		const idx = i % parts;
		result[idx] = (result[idx] ?? 0) + 1;
		remainder--;
		i++;
	}
	return result;
};

// NFKD + stripping anything outside a-z0-9 turns accented Latin letters into
// their closest ASCII form (e.g. "é" → "e") before collapsing to hyphens.
const slugSafe = (raw: string): string =>
	raw
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

/** Kebab-case a display name and append a numeric suffix for uniqueness. */
export const slugify = (name: string, uniqueSuffix: number): string => {
	const base = slugSafe(name) || "item";
	return `${base}-${uniqueSuffix}`;
};
