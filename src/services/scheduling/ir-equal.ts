// ---------------------------------------------------------------------------
// Structural equality for IR trees
//
// Used by the scheduling layer to decide whether two component trees differ.
// Temporal values are compared by their canonical ISO form, binary values byte
// by byte, and plain objects key by key regardless of insertion order.
// ---------------------------------------------------------------------------

/** True when both sides are arrays of pairwise-equal items */
const arraysEqual = (a: ReadonlyArray<unknown>, b: unknown): boolean =>
	Array.isArray(b) &&
	a.length === b.length &&
	a.every((item, i) => irEquals(item, b[i]));

/** True when both sides are byte arrays with identical contents */
const bytesEqual = (a: Uint8Array, b: unknown): boolean =>
	b instanceof Uint8Array &&
	a.length === b.length &&
	a.every((byte, i) => byte === b[i]);

/** Temporal values (and anything else ISO-serializable) compare by their string form */
const isIsoSerializable = (value: object): boolean =>
	typeof (value as { toJSON?: unknown }).toJSON === "function";

/** True when both sides have the same own keys with pairwise-equal values */
const objectsEqual = (a: object, b: object): boolean => {
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) {
		return false;
	}
	const bRecord = b as Record<string, unknown>;
	return aKeys.every(
		(key) =>
			Object.hasOwn(b, key) &&
			irEquals((a as Record<string, unknown>)[key], bRecord[key]),
	);
};

/** Deep structural equality for IR values, properties and components */
export const irEquals = (a: unknown, b: unknown): boolean => {
	if (a === b) {
		return true;
	}
	if (
		typeof a !== "object" ||
		typeof b !== "object" ||
		a === null ||
		b === null
	) {
		return false;
	}
	if (Array.isArray(a)) {
		return arraysEqual(a, b);
	}
	if (a instanceof Uint8Array) {
		return bytesEqual(a, b);
	}
	if (isIsoSerializable(a) && isIsoSerializable(b)) {
		return String(a) === String(b);
	}
	return objectsEqual(a, b);
};
