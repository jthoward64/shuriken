// ---------------------------------------------------------------------------
// REPORT body parsing utilities
//
// Shared by all REPORT sub-handlers.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import { type ClarkName, cn } from "#src/data/ir.ts";
import { badRequest, type DavError } from "#src/domain/errors.ts";
import { normalizeClarkNames } from "#src/http/dav/xml/clark.ts";
import { parseXml, readXmlBody } from "#src/http/dav/xml/parser.ts";

const DAV_NS = "DAV:";

// ---------------------------------------------------------------------------
// parseReportBody
// ---------------------------------------------------------------------------

/**
 * Read the REPORT request body, parse as XML, and return:
 * - `type`: Clark-notation name of the root report element (e.g.
 *   `{DAV:}sync-collection`, `{urn:...caldav}calendar-query`)
 * - `tree`: Clark-normalized children of the root element (as a plain object)
 *
 * Returns a `DavError` (400) if the body is empty or unparseable.
 */
export const parseReportBody = (
	req: Request,
): Effect.Effect<{ type: ClarkName; tree: unknown }, DavError> =>
	readXmlBody(req).pipe(
		Effect.flatMap((body) =>
			parseXml(body).pipe(
				Effect.map((raw) => {
					const normalized = normalizeClarkNames(raw) as Record<
						string,
						unknown
					>;
					// The root element key is the report type in Clark notation.
					// After normalizeClarkNames, legitimate element keys are Clark
					// names like `{namespace}localname`. We skip `?xml` (the XML
					// declaration emitted by fast-xml-parser) and `@_*` attributes.
					const reportType = Object.keys(normalized).find((k) =>
						k.startsWith("{"),
					) as ClarkName | undefined;
					if (!reportType) {
						return { type: cn(DAV_NS, "unknown") as ClarkName, tree: {} };
					}
					return {
						type: reportType,
						tree: normalized[reportType] ?? {},
					};
				}),
				Effect.catchTag("XmlParseError", () =>
					Effect.fail(badRequest("Malformed REPORT XML")),
				),
			),
		),
	);

// ---------------------------------------------------------------------------
// extractPropNames
// ---------------------------------------------------------------------------

/**
 * Extract `<D:prop>` child names from a Clark-normalized element tree.
 *
 * Looks for a `{DAV:}prop` key whose value is an object; returns the set of
 * Clark-notation keys found inside it (excluding XML attribute keys `@_...`).
 *
 * Returns an empty set if `{DAV:}prop` is absent.
 */
export const extractPropNames = (tree: unknown): ReadonlySet<ClarkName> => {
	if (typeof tree !== "object" || tree === null) {
		return new Set();
	}
	const propEl = (tree as Record<string, unknown>)[cn(DAV_NS, "prop")];
	if (typeof propEl !== "object" || propEl === null) {
		return new Set();
	}
	return new Set(
		Object.keys(propEl as Record<string, unknown>)
			.filter((k) => !k.startsWith("@_"))
			.map((k) => k as ClarkName),
	);
};

// ---------------------------------------------------------------------------
// extractHrefs
// ---------------------------------------------------------------------------

/**
 * Extract the text of one `{DAV:}href` node.
 *
 * A bare `<D:href>/x</D:href>` parses to a string, but an `<D:href>` that
 * carries its own attributes — most importantly a per-element `xmlns:`
 * declaration, which iOS/macOS emit on EVERY href in a multiget — parses to an
 * object whose text lives under `#text` (the xmlns attr is consumed by Clark
 * normalization). Handle both, or return null for anything else.
 */
const hrefText = (node: unknown): string | null => {
	if (typeof node === "string") {
		return node;
	}
	if (typeof node === "object" && node !== null) {
		const text = (node as Record<string, unknown>)["#text"];
		return typeof text === "string" ? text : null;
	}
	return null;
};

/**
 * Extract all `<D:href>` text values from a Clark-normalized element tree.
 *
 * Handles a single `{DAV:}href` or an array of them (fast-xml-parser collapses
 * duplicate elements into an array), and — critically — hrefs that parse to an
 * object because they carry a per-element `xmlns:` attribute (Apple clients).
 *
 * Returns an empty array if no hrefs are found.
 */
export const extractHrefs = (tree: unknown): ReadonlyArray<string> => {
	if (typeof tree !== "object" || tree === null) {
		return [];
	}
	const hrefEl = (tree as Record<string, unknown>)[cn(DAV_NS, "href")];
	const nodes = Array.isArray(hrefEl) ? hrefEl : [hrefEl];
	return nodes
		.map(hrefText)
		.filter((h): h is string => h !== null && h.length > 0);
};
