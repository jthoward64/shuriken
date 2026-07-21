// ---------------------------------------------------------------------------
// address-data subsetting — RFC 6352 §8.5
//
// Parses <C:address-data> elements from REPORT request bodies and applies
// the described property filters to an IrDocument (vCard) before serialization.
// ---------------------------------------------------------------------------

import type { IrDocument } from "#src/data/ir.ts";
import { downgradeToV3 } from "#src/data/vcard/downgrade-v3.ts";

const CARDDAV_NS = "urn:ietf:params:xml:ns:carddav";
const cn = (local: string): string => `{${CARDDAV_NS}}${local}`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** vCard versions the server can serialize to. Canonical storage is 4.0. */
export type VCardVersion = "3.0" | "4.0";

export interface AddressDataSpec {
	/** If true, return the full IrDocument without subsetting. */
	readonly allProps: boolean;
	/** Explicit vCard property names to include (when allProps = false). Empty when allProps = true. */
	readonly props: ReadonlySet<string>;
	/** Requested vCard version (RFC 6352 §10.4.2 `version` attr); undefined = server default (4.0). */
	readonly version: VCardVersion | undefined;
}

// ---------------------------------------------------------------------------
// parseAddressDataSpec
// ---------------------------------------------------------------------------

/** Read the `version` attribute off a `<C:address-data>` element (RFC 6352 §10.4.2). */
const parseVersion = (tree: unknown): VCardVersion | undefined => {
	if (typeof tree !== "object" || tree === null) {
		return undefined;
	}
	const raw = (tree as Record<string, unknown>)["@_version"];
	return raw === "3.0" || raw === "4.0" ? raw : undefined;
};

/**
 * Parse the contents of a Clark-normalized `<C:address-data>` element.
 * Returns `allProps: true` when the element is absent or has no prop children;
 * the requested `version` is read independently of prop subsetting.
 */
export const parseAddressDataSpec = (tree: unknown): AddressDataSpec => {
	const version = parseVersion(tree);
	const allProps: AddressDataSpec = {
		allProps: true,
		props: new Set(),
		version,
	};
	if (typeof tree !== "object" || tree === null) {
		return allProps;
	}
	const propEls = (tree as Record<string, unknown>)[cn("prop")];
	if (!propEls) {
		return allProps;
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
		return allProps;
	}

	return { allProps: false, props, version };
};

/** Apply a negotiated version to a canonical 4.0 vCard: downgrade to 3.0 when requested. */
export const applyVersion = (
	doc: IrDocument,
	version: VCardVersion | undefined,
): IrDocument => (version === "3.0" ? downgradeToV3(doc) : doc);

// ---------------------------------------------------------------------------
// subsetVCardDocument
// ---------------------------------------------------------------------------

/**
 * vCard properties that must always be included regardless of the spec.
 * RFC 6350 §6.7.9: VERSION is always mandatory.
 * RFC 6350 §6.2.1: FN is always required in vCard 4.0.
 */
const isAlwaysRequiredVCardProp = (propName: string): boolean =>
	propName === "VERSION" || propName === "FN";

/**
 * Apply an AddressDataSpec to a vCard IrDocument, returning a new IrDocument
 * with only the requested properties.
 *
 * RFC 6352 §8.5.1: mandatory vCard properties (VERSION, FN) must always be
 * included even when the client requests a specific subset.
 */
export const subsetVCardDocument = (
	doc: IrDocument,
	spec: AddressDataSpec,
): IrDocument => {
	if (spec.allProps) {
		return doc;
	}

	const filteredProperties = doc.root.properties.filter(
		(p) => spec.props.has(p.name) || isAlwaysRequiredVCardProp(p.name),
	);

	return {
		...doc,
		root: { ...doc.root, properties: filteredProperties },
	};
};
