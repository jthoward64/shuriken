// ---------------------------------------------------------------------------
// address-data subsetting — RFC 6352 §8.5
//
// Parses <C:address-data> elements from REPORT request bodies and applies
// the described property filters to an IrDocument (vCard) before serialization.
// ---------------------------------------------------------------------------

import type { IrDocument } from "#src/data/ir.ts";

const CARDDAV_NS = "urn:ietf:params:xml:ns:carddav";
const cn = (local: string): string => `{${CARDDAV_NS}}${local}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AddressDataSpec {
	/** If true, return the full IrDocument without subsetting. */
	readonly allProps: boolean;
	/** Explicit vCard property names to include (when allProps = false). Empty when allProps = true. */
	readonly props: ReadonlySet<string>;
}

const ALLPROPS: AddressDataSpec = { allProps: true, props: new Set() };

// ---------------------------------------------------------------------------
// parseAddressDataSpec
// ---------------------------------------------------------------------------

/**
 * Parse the contents of a Clark-normalized `<C:address-data>` element.
 * Returns `{ allProps: true }` when the element is absent or has no prop children.
 */
export const parseAddressDataSpec = (tree: unknown): AddressDataSpec => {
	if (typeof tree !== "object" || tree === null) {
		return ALLPROPS;
	}
	const propEls = (tree as Record<string, unknown>)[cn("prop")];
	if (!propEls) {
		return ALLPROPS;
	}

	const props = new Set<string>();
	const arr = Array.isArray(propEls) ? propEls : [propEls];
	for (const p of arr) {
		if (
			typeof p === "object" &&
			p !== null &&
			typeof (p as Record<string, unknown>)["@_name"] === "string"
		) {
			props.add((p as Record<string, unknown>)["@_name"] as string);
		}
	}

	if (props.size === 0) {
		return ALLPROPS;
	}

	return { allProps: false, props };
};

// ---------------------------------------------------------------------------
// subsetVCardDocument
// ---------------------------------------------------------------------------

/**
 * Apply an AddressDataSpec to a vCard IrDocument, returning a new IrDocument
 * with only the requested properties.
 *
 * RFC 6352 §8.6.1: only the properties listed in <C:prop name="..."/> children
 * are returned. No implicit additions are made — the client controls the subset.
 */
export const subsetVCardDocument = (
	doc: IrDocument,
	spec: AddressDataSpec,
): IrDocument => {
	if (spec.allProps) {
		return doc;
	}

	const filteredProperties = doc.root.properties.filter((p) =>
		spec.props.has(p.name),
	);

	return {
		...doc,
		root: { ...doc.root, properties: filteredProperties },
	};
};
