// ---------------------------------------------------------------------------
// vCard filter parsing and evaluation — RFC 6352 §8.6
//
// Parses <CARDDAV:filter> elements and evaluates them against an IrDocument.
// ---------------------------------------------------------------------------

import { Effect } from "effect";
import type { IrDocument, IrProperty } from "#src/data/ir.ts";
import type { DavError } from "#src/domain/errors.ts";
import { forbidden } from "#src/domain/errors.ts";

const CARDDAV_NS = "urn:ietf:params:xml:ns:carddav";
const cn = (local: string): string => `{${CARDDAV_NS}}${local}`;

/** True when an unknown value is a plain (non-null) object */
const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TextMatch {
	readonly value: string;
	readonly collation: "i;ascii-casemap" | "i;unicode-casemap" | "i;octet";
	readonly matchType: "equals" | "contains" | "starts-with" | "ends-with";
	readonly negate: boolean;
}

export interface ParamFilter {
	readonly name: string;
	readonly isNotDefined?: boolean;
	readonly textMatch?: TextMatch;
}

export interface CardPropFilter {
	readonly name: string;
	readonly test: "anyof" | "allof";
	readonly isNotDefined?: boolean;
	readonly textMatches: ReadonlyArray<TextMatch>;
	readonly paramFilters: ReadonlyArray<ParamFilter>;
}

export interface CardFilter {
	readonly test: "anyof" | "allof";
	readonly propFilters: ReadonlyArray<CardPropFilter>;
}

// ---------------------------------------------------------------------------
// parseCardFilter
// ---------------------------------------------------------------------------

export const parseCardFilter = (
	tree: unknown,
): Effect.Effect<CardFilter, DavError> => {
	if (!isRecord(tree)) {
		return Effect.fail(forbidden("CARDDAV:valid-filter"));
	}
	const filterEl = tree[cn("filter")];
	// The <filter> element is required (RFC 6352 §8.6), but an EMPTY <filter/> is
	// valid and matches every card (§10.5.1) — and it's what iOS Contacts sends
	// to fetch the whole address book. fast-xml-parser collapses an empty element
	// to "" (a string) rather than an object, so treat any present-but-non-object
	// filter as an empty (match-all) filter instead of rejecting it with a 403.
	// Only a wholly absent <filter> is invalid.
	if (filterEl === undefined) {
		return Effect.fail(forbidden("CARDDAV:valid-filter"));
	}
	const filterObj: Record<string, unknown> = isRecord(filterEl) ? filterEl : {};
	const test = filterObj["@_test"] === "anyof" ? "anyof" : "allof";

	const propFilterEls = filterObj[cn("prop-filter")];
	const propFilters = parseChildren(propFilterEls, parsePropFilter);

	return Effect.succeed({ test, propFilters });
};

const parsePropFilter = (el: unknown): CardPropFilter => {
	if (!isRecord(el)) {
		return { name: "", test: "allof", textMatches: [], paramFilters: [] };
	}
	const name = typeof el["@_name"] === "string" ? el["@_name"] : "";
	const test = el["@_test"] === "anyof" ? "anyof" : "allof";
	const isNotDefined = cn("is-not-defined") in el;

	const textMatches = parseChildren(el[cn("text-match")], parseTextMatch);
	const paramFilters = parseChildren(el[cn("param-filter")], parseParamFilter);

	return { name, test, isNotDefined, textMatches, paramFilters };
};

const parseParamFilter = (el: unknown): ParamFilter => {
	if (!isRecord(el)) {
		return { name: "" };
	}
	const name = typeof el["@_name"] === "string" ? el["@_name"] : "";
	const isNotDefined = cn("is-not-defined") in el;
	const textMatch = parseTextMatchMaybe(el[cn("text-match")]);
	return { name, isNotDefined, textMatch };
};

const parseTextMatch = (el: unknown): TextMatch => {
	// fast-xml-parser collapses a text-only `<C:text-match>foo</C:text-match>`
	// (no attributes — what most clients send) to a bare string/number; only an
	// element with attributes becomes an object with `#text`. Treat the bare
	// form as the match value, otherwise the filter degrades to matching every
	// record (value "" → contains "" → always true).
	if (typeof el === "string" || typeof el === "number") {
		return {
			value: String(el),
			collation: "i;ascii-casemap",
			matchType: "contains",
			negate: false,
		};
	}
	if (!isRecord(el)) {
		return {
			value: "",
			collation: "i;ascii-casemap",
			matchType: "contains",
			negate: false,
		};
	}
	const rawText = el["#text"];
	const value =
		typeof rawText === "string"
			? rawText
			: typeof rawText === "number"
				? String(rawText)
				: "";
	return {
		value,
		collation: parseCollation(el["@_collation"]),
		matchType: parseMatchType(el["@_match-type"]),
		negate: el["@_negate-condition"] === "yes",
	};
};

/** Read a `collation` attribute, defaulting to the RFC 6352 default collation */
const parseCollation = (raw: unknown): TextMatch["collation"] =>
	raw === "i;unicode-casemap" || raw === "i;octet" ? raw : "i;ascii-casemap";

/** Read a `match-type` attribute, defaulting to `contains` */
const parseMatchType = (raw: unknown): TextMatch["matchType"] =>
	raw === "equals" || raw === "starts-with" || raw === "ends-with"
		? raw
		: "contains";

const parseTextMatchMaybe = (el: unknown): TextMatch | undefined => {
	if (!el) {
		return undefined;
	}
	return parseTextMatch(el);
};

const parseChildren = <T>(
	el: unknown,
	parse: (el: unknown) => T,
): ReadonlyArray<T> => {
	if (!el) {
		return [];
	}
	const arr = Array.isArray(el) ? el : [el];
	return arr.map(parse);
};

// ---------------------------------------------------------------------------
// evaluateCardFilter
// ---------------------------------------------------------------------------

export const evaluateCardFilter = (
	doc: IrDocument,
	filter: CardFilter,
): boolean => {
	const vcard = doc.root;
	if (filter.propFilters.length === 0) {
		return true;
	}

	if (filter.test === "anyof") {
		return filter.propFilters.some((pf) =>
			evalPropFilter(vcard.properties, pf),
		);
	}
	return filter.propFilters.every((pf) => evalPropFilter(vcard.properties, pf));
};

const evalPropFilter = (
	properties: ReadonlyArray<IrProperty>,
	f: CardPropFilter,
): boolean => {
	const props = properties.filter(
		(p) => p.name.toUpperCase() === f.name.toUpperCase(),
	);

	if (f.isNotDefined) {
		return props.length === 0;
	}
	if (props.length === 0) {
		return false;
	}

	// The filter passes if any one property instance matches all its conditions.
	return props.some((prop) => {
		const textOk = evalTextMatches(propValueText(prop), f.test, f.textMatches);
		if (!textOk) {
			return false;
		}
		for (const pf of f.paramFilters) {
			if (!evalParamFilter(prop, pf)) {
				return false;
			}
		}
		return true;
	});
};

const evalTextMatches = (
	text: string,
	test: "anyof" | "allof",
	tms: ReadonlyArray<TextMatch>,
): boolean => {
	if (tms.length === 0) {
		return true;
	}
	if (test === "anyof") {
		return tms.some((tm) => evalTextMatch(text, tm));
	}
	return tms.every((tm) => evalTextMatch(text, tm));
};

const evalParamFilter = (prop: IrProperty, f: ParamFilter): boolean => {
	const params = prop.parameters.filter(
		(p) => p.name.toUpperCase() === f.name.toUpperCase(),
	);
	if (f.isNotDefined) {
		return params.length === 0;
	}
	if (params.length === 0) {
		return false;
	}
	if (f.textMatch) {
		const tm = f.textMatch;
		return params.some((p) => evalTextMatch(p.value, tm));
	}
	return true;
};

// i;octet is an exact, case-sensitive comparison; the casemap collations
// fold case (RFC 6352 §8.6.2 / RFC 4790).
const COLLATION_FOLD: Readonly<
	Record<TextMatch["collation"], (s: string) => string>
> = {
	"i;octet": (s) => s,
	"i;unicode-casemap": (s) => s.normalize("NFC").toLowerCase(),
	"i;ascii-casemap": (s) => s.toLowerCase(),
};

/** Comparison performed by each RFC 6352 text-match `match-type` */
const MATCH_TYPE_TEST: Readonly<
	Record<TextMatch["matchType"], (haystack: string, needle: string) => boolean>
> = {
	equals: (haystack, needle) => haystack === needle,
	contains: (haystack, needle) => haystack.includes(needle),
	"starts-with": (haystack, needle) => haystack.startsWith(needle),
	"ends-with": (haystack, needle) => haystack.endsWith(needle),
};

const evalTextMatch = (text: string, tm: TextMatch): boolean => {
	const fold = COLLATION_FOLD[tm.collation];
	const matches = MATCH_TYPE_TEST[tm.matchType](fold(text), fold(tm.value));
	return tm.negate ? !matches : matches;
};

const propValueText = (prop: IrProperty): string => {
	const v = prop.value;
	if (v.type === "TEXT") {
		return v.value;
	}
	// Multi-valued vCard properties (CATEGORIES, NICKNAME, …). Render the
	// comma-joined form so a text-match sees every member, not an empty string.
	if (v.type === "TEXT_LIST") {
		return v.value.join(",");
	}
	if (v.type === "DATE_LIST" || v.type === "DATE_TIME_LIST") {
		return v.value.map((item) => item.toString()).join(",");
	}
	if ("value" in v && typeof v.value === "string") {
		return v.value;
	}
	return "";
};
