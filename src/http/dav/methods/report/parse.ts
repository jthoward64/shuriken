// ---------------------------------------------------------------------------
// REPORT body parsing utilities
//
// Shared by all REPORT sub-handlers.
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";
import { type ClarkName, cn } from "#src/data/ir.ts";
import { badRequest, type DavError } from "#src/domain/errors.ts";
import { normalizeClarkNames } from "#src/http/dav/xml/clark.ts";
import { parseXml, readXmlBody } from "#src/http/dav/xml/parser.ts";

const DAV_NS = "DAV:";

/** True when an unknown value is a plain (non-null) object */
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

/** True when a parsed element key is a Clark name (`{namespace}localname`) */
const isClarkKey = (key: string): key is ClarkName => key.startsWith("{");

/** The report type and child tree of an already Clark-normalized root element */
export interface ReportRoot {
	readonly type: ClarkName;
	readonly tree: unknown;
}

const UNKNOWN_REPORT: ReportRoot = { type: cn(DAV_NS, "unknown"), tree: {} };

/**
 * Read the report type and child tree from a parsed XML root.
 *
 * The root element key is the report type in Clark notation; `?xml` (the XML
 * declaration emitted by fast-xml-parser) and `@_*` attributes are skipped.
 */
const readReportRoot = (raw: unknown): ReportRoot => {
	const normalized = normalizeClarkNames(raw);
	if (!isRecord(normalized)) {
		return UNKNOWN_REPORT;
	}
	const reportType = Object.keys(normalized).find(isClarkKey);
	if (reportType === undefined) {
		return UNKNOWN_REPORT;
	}
	return { type: reportType, tree: normalized[reportType] ?? {} };
};

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
): Effect.Effect<ReportRoot, DavError> =>
	readXmlBody(req).pipe(
		Effect.flatMap(parseXml),
		Effect.map(readReportRoot),
		Effect.catchTag("XmlParseError", () =>
			Effect.fail(badRequest("Malformed REPORT XML")),
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
	if (!isRecord(tree)) {
		return new Set();
	}
	const propEl = tree[cn(DAV_NS, "prop")];
	if (!isRecord(propEl)) {
		return new Set();
	}
	return new Set(
		Object.keys(propEl)
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
 * A bare `<D:href>/x</D:href>` parses to a string, but an href carrying any
 * attribute of its own parses to an object whose text lives under `#text` (the
 * xmlns attr itself is consumed by Clark normalization). KDE/Qt clients hit the
 * latter: they declare `xmlns="DAV:"` on each href rather than using a prefix.
 * Handle both; anything else yields `Option.none`.
 */
const hrefText = (node: unknown): Option.Option<string> => {
	if (typeof node === "string") {
		return Option.some(node);
	}
	if (isRecord(node)) {
		const text = node["#text"];
		return typeof text === "string" ? Option.some(text) : Option.none();
	}
	return Option.none();
};

/**
 * True when a parsed element key names an `href` element, regardless of how its
 * namespace prefix resolved. We match by LOCAL NAME because iOS/macOS multiget
 * bodies declare `xmlns:` on `<prop>` and then reuse that prefix on the sibling
 * `<href>` elements without declaring it in their own scope (technically invalid
 * but ubiquitous). Clark normalization then can't resolve the prefix and leaves
 * the key as e.g. `"A:href"` instead of `"{DAV:}href"`. In a multiget/report
 * body the only `href`-named elements are DAV hrefs, so this is unambiguous.
 *
 * Matches: `{DAV:}href` (resolved), `A:href` (unresolved prefix), `href` (none).
 */
const isHrefKey = (key: string): boolean =>
	key === "href" || key.endsWith(":href") || key.endsWith("}href");

/**
 * Extract all `href` text values from a Clark-normalized element tree.
 *
 * Handles a single value or an array (fast-xml-parser collapses duplicate
 * elements into an array), hrefs that parse to an object because they carry a
 * per-element attribute (text under `#text`), and hrefs whose namespace prefix
 * didn't resolve to `{DAV:}` (Apple clients — see `isHrefKey`).
 *
 * Returns an empty array if no hrefs are found.
 */
export const extractHrefs = (tree: unknown): ReadonlyArray<string> => {
	if (!isRecord(tree)) {
		return [];
	}
	return Object.entries(tree)
		.filter(([key]) => isHrefKey(key))
		.flatMap(([, value]) => (Array.isArray(value) ? value : [value]))
		.flatMap((node) => Option.toArray(hrefText(node)))
		.filter((href) => href.length > 0);
};
