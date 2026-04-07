// ---------------------------------------------------------------------------
// Namespace registry for outgoing XML serialization
//
// Clark notation ({uri}localname) is the internal canonical form everywhere.
// This module owns the single conversion point from Clark keys to the
// prefix:localname form required by fast-xml-builder.
//
// The registry assigns canonical short prefixes to known namespaces and
// generates deterministic `ns0`, `ns1`, ... prefixes for unknown ones.
// All namespace declarations are collected once and emitted on the root element.
//
// XML Namespaces guarantees that any compliant client resolves element names
// via xmlns:* declarations, regardless of which prefix the server chose. So
// the prefix assignment is entirely a server-side concern.
// ---------------------------------------------------------------------------

import type { ClarkName } from "#src/data/ir.ts";

// Well-known namespace URI → canonical prefix mapping.
// Order matters: first entry wins if a future conflict arises.
const WELL_KNOWN: ReadonlyArray<readonly [uri: string, prefix: string]> = [
	["DAV:", "D"],
	["urn:ietf:params:xml:ns:caldav", "C"],
	["urn:ietf:params:xml:ns:carddav", "CR"],
	["urn:ietf:params:xml:ns:ical-types", "IC"],
	["http://apple.com/ns/ical/", "AI"],
];

const WELL_KNOWN_URI_TO_PREFIX = new Map<string, string>(
	WELL_KNOWN.map(([uri, prefix]) => [uri, prefix]),
);

// ---------------------------------------------------------------------------
// ClarkKey type — alias to ClarkName so callers can use either
// ---------------------------------------------------------------------------

export type ClarkKey = ClarkName;

// ---------------------------------------------------------------------------
// NsRegistry
// ---------------------------------------------------------------------------

export interface NsRegistry {
	/**
	 * Convert a Clark-notation key `{uri}localname` to `prefix:localname`.
	 * Registers the namespace URI if not seen before, assigning a prefix.
	 * Non-Clark keys (no leading `{`) are returned unchanged.
	 */
	readonly toXmlKey: (clark: ClarkKey) => string;

	/**
	 * Return all namespace declarations accumulated so far, as `@_xmlns:*`
	 * attributes ready to be merged into the root XML element object.
	 */
	readonly declarations: () => Readonly<Record<string, string>>;
}

export const makeNsRegistry = (): NsRegistry => {
	const prefixToUri = new Map<string, string>();
	const uriToPrefix = new Map<string, string>();
	let unknownCounter = 0;

	const registerUri = (uri: string): string => {
		const existing = uriToPrefix.get(uri);
		if (existing !== undefined) {
			return existing;
		}

		// Prefer the canonical prefix for well-known URIs
		const canonical = WELL_KNOWN_URI_TO_PREFIX.get(uri);
		let prefix = canonical;

		if (prefix === undefined || prefixToUri.has(prefix)) {
			// Generate a unique prefix
			do {
				prefix = `ns${unknownCounter++}`;
			} while (prefixToUri.has(prefix));
		}

		uriToPrefix.set(uri, prefix);
		prefixToUri.set(prefix, uri);
		return prefix;
	};

	const clarkRe = /^\{([^}]+)\}(.+)$/;

	return {
		toXmlKey(clark: ClarkKey): string {
			const m = clarkRe.exec(clark);
			if (!m) {
				return clark; // not a Clark key — pass through
			}
			const uri = m[1] as string;
			const localName = m[2] as string;
			const prefix = registerUri(uri);
			return `${prefix}:${localName}`;
		},

		declarations(): Readonly<Record<string, string>> {
			const result: Record<string, string> = {};
			for (const [uri, prefix] of uriToPrefix) {
				result[`@_xmlns:${prefix}`] = uri;
			}
			return result;
		},
	};
};
