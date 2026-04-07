// ---------------------------------------------------------------------------
// Clark-name normalization for fast-xml-parser output
//
// fast-xml-parser preserves whatever namespace prefix the client chose (e.g.
// "D:", "A:", "B:"). Every DAV handler that reads incoming XML must look up
// elements by their true namespace URI, not by an arbitrary client prefix.
//
// Clark notation — `{namespace-uri}localname` — is the standard way to
// identify XML names namespace-independently.
//
// This module converts a fast-xml-parser result tree to Clark notation:
//   "D:prop" (with xmlns:D="DAV:") → "{DAV:}prop"
//   "@_D:foo" (attr)               → "@_{DAV:}foo"
//   "@_xmlns:D", "@_xmlns"         → consumed, not emitted
// ---------------------------------------------------------------------------

// `{namespace}localname` string — Clark notation for XML element/attribute names.
export type ClarkKey = `{${string}}${string}`;

type PrefixMap = Readonly<Record<string, string>>;

const XMLNS_DEFAULT = "@_xmlns";
const XMLNS_PREFIX = "@_xmlns:";
const ATTR_PREFIX = "@_";

/** Build a prefix→URI map from the xmlns declarations on an element node. */
const buildPrefixMap = (
	obj: Record<string, unknown>,
	inherited: PrefixMap,
): PrefixMap => {
	const map: Record<string, string> = { ...inherited };
	for (const [key, value] of Object.entries(obj)) {
		if (typeof value !== "string") {
			continue;
		}
		if (key === XMLNS_DEFAULT) {
			map[""] = value; // default namespace
		} else if (key.startsWith(XMLNS_PREFIX)) {
			map[key.slice(XMLNS_PREFIX.length)] = value;
		}
	}
	return map;
};

/**
 * Resolve a `prefix:localname` element key to Clark notation using `prefixMap`.
 * Keys without a colon use the default namespace ("") if declared; otherwise
 * pass through unchanged.
 */
const resolveElementKey = (key: string, prefixMap: PrefixMap): string => {
	const colonIdx = key.indexOf(":");
	if (colonIdx === -1) {
		const defaultNs = prefixMap[""];
		return defaultNs ? `{${defaultNs}}${key}` : key;
	}
	const prefix = key.slice(0, colonIdx);
	const localName = key.slice(colonIdx + 1);
	const uri = prefixMap[prefix];
	return uri ? `{${uri}}${localName}` : key;
};

/**
 * Resolve a `@_prefix:localname` attribute key to Clark notation.
 * Attributes without a prefix do NOT use the default namespace (XML §6.1.1).
 */
const resolveAttrKey = (key: string, prefixMap: PrefixMap): string => {
	const attrName = key.slice(ATTR_PREFIX.length);
	const colonIdx = attrName.indexOf(":");
	if (colonIdx === -1) {
		return key; // no prefix → pass through unchanged
	}
	const prefix = attrName.slice(0, colonIdx);
	const localName = attrName.slice(colonIdx + 1);
	const uri = prefixMap[prefix];
	return uri ? `${ATTR_PREFIX}{${uri}}${localName}` : key;
};

/**
 * Recursively normalize a fast-xml-parser result tree so every element and
 * attribute key uses Clark notation `{uri}localname`.
 *
 * In fast-xml-parser output, an element's own `xmlns:*` declarations appear
 * as attributes inside that element's object. Per the XML Namespaces spec,
 * these declarations are in scope for the element's own name. Therefore, when
 * resolving an element key we must look at the child object's xmlns attrs, not
 * just the inherited map from the parent.
 *
 * - `@_xmlns:*` and `@_xmlns` attributes are consumed to build the prefix map
 *   and are not emitted in the output.
 * - Attribute keys (`@_prefix:localname`) are normalized to `@_{uri}localname`.
 * - Unprefixed attributes (`@_name`) are passed through unchanged.
 * - Nested elements inherit the parent's prefix map unless they declare their own.
 * - Arrays are normalized element-by-element.
 * - Non-object values (strings, numbers, etc.) are returned unchanged.
 *
 * Returns `unknown` to force callers to extract properties safely.
 */
export const normalizeClarkNames = (
	node: unknown,
	inheritedPrefixes: PrefixMap = {},
): unknown => {
	if (Array.isArray(node)) {
		return node.map((item) => normalizeClarkNames(item, inheritedPrefixes));
	}
	if (typeof node !== "object" || node === null) {
		return node;
	}

	const obj = node as Record<string, unknown>;

	// Build the prefix map for THIS node from its own xmlns declarations plus
	// what it inherited. This map is used for THIS node's attribute keys.
	const selfPrefixMap = buildPrefixMap(obj, inheritedPrefixes);

	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(obj)) {
		// Consume xmlns declarations — don't emit them
		if (key === XMLNS_DEFAULT || key.startsWith(XMLNS_PREFIX)) {
			continue;
		}

		if (key.startsWith(ATTR_PREFIX)) {
			// Attribute: resolve using this element's own prefix map
			result[resolveAttrKey(key, selfPrefixMap)] = value;
		} else {
			// Element key: per the XML spec, the child element's own xmlns
			// declarations are in scope for that element's name. Build the
			// child's prefix map (inherited self + child's own xmlns attrs)
			// and use it to resolve the key AND to recurse into the child.
			const childPrefixMap =
				typeof value === "object" && value !== null && !Array.isArray(value)
					? buildPrefixMap(value as Record<string, unknown>, selfPrefixMap)
					: selfPrefixMap;
			result[resolveElementKey(key, childPrefixMap)] = normalizeClarkNames(
				value,
				childPrefixMap,
			);
		}
	}

	return result;
};
