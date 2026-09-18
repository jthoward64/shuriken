// Narrowing helpers for the Clark-normalized XML trees produced by
// `normalizeClarkNames`. The parser hands back `unknown`, so handlers walk it
// with these guards instead of asserting a shape.

/** True when `value` is an element node (a keyed object, not an array or text) */
export const isXmlNode = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** True when `value` is an element node or an array of them */
export const isXmlNodeOrArray = (
	value: unknown,
): value is Record<string, unknown> | ReadonlyArray<unknown> =>
	typeof value === "object" && value !== null;

/** Reads a child of `node` as a string, or undefined when absent or structured */
export const xmlText = (
	node: Record<string, unknown>,
	key: string,
): string | undefined => {
	const value = node[key];
	return typeof value === "string" ? value : undefined;
};

/** Reads a child element of `node`, or undefined when absent or not an element */
export const xmlChild = (
	node: Record<string, unknown>,
	key: string,
): Record<string, unknown> | undefined => {
	const value = node[key];
	return isXmlNode(value) ? value : undefined;
};

/** Walks a chain of Clark-named child elements, stopping at the first missing one */
export const xmlPath = (
	tree: unknown,
	...keys: ReadonlyArray<string>
): Record<string, unknown> | undefined => {
	let node = isXmlNode(tree) ? tree : undefined;
	for (const key of keys) {
		node = node === undefined ? undefined : xmlChild(node, key);
	}
	return node;
};
