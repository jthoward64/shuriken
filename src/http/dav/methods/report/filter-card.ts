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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TextMatch {
	readonly value: string;
	readonly collation: "i;ascii-casemap" | "i;unicode-casemap";
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
	if (typeof tree !== "object" || tree === null) {
		return Effect.fail(forbidden("CARDDAV:valid-filter"));
	}
	const obj = tree as Record<string, unknown>;
	const filterEl = obj[cn("filter")];
	if (typeof filterEl !== "object" || filterEl === null) {
		return Effect.fail(forbidden("CARDDAV:valid-filter"));
	}
	const filterObj = filterEl as Record<string, unknown>;
	const test = filterObj["@_test"] === "anyof" ? "anyof" : "allof";

	const propFilterEls = filterObj[cn("prop-filter")];
	const propFilters = parseChildren(propFilterEls, parsePropFilter);

	return Effect.succeed({ test, propFilters });
};

const parsePropFilter = (el: unknown): CardPropFilter => {
	if (typeof el !== "object" || el === null) {
		return { name: "", test: "allof", textMatches: [], paramFilters: [] };
	}
	const obj = el as Record<string, unknown>;
	const name = typeof obj["@_name"] === "string" ? obj["@_name"] : "";
	const test = obj["@_test"] === "anyof" ? "anyof" : "allof";
	const isNotDefined = cn("is-not-defined") in obj;

	const textMatches = parseChildren(obj[cn("text-match")], parseTextMatch);
	const paramFilters = parseChildren(obj[cn("param-filter")], parseParamFilter);

	return { name, test, isNotDefined, textMatches, paramFilters };
};

const parseParamFilter = (el: unknown): ParamFilter => {
	if (typeof el !== "object" || el === null) {
		return { name: "" };
	}
	const obj = el as Record<string, unknown>;
	const name = typeof obj["@_name"] === "string" ? obj["@_name"] : "";
	const isNotDefined = cn("is-not-defined") in obj;
	const textMatch = parseTextMatchMaybe(obj[cn("text-match")]);
	return { name, isNotDefined, textMatch };
};

const parseTextMatch = (el: unknown): TextMatch => {
	if (typeof el !== "object" || el === null) {
		return {
			value: "",
			collation: "i;ascii-casemap",
			matchType: "contains",
			negate: false,
		};
	}
	const obj = el as Record<string, unknown>;
	const value = typeof obj["#text"] === "string" ? obj["#text"] : "";
	const collation =
		obj["@_collation"] === "i;unicode-casemap"
			? "i;unicode-casemap"
			: "i;ascii-casemap";
	const matchType = (
		["equals", "contains", "starts-with", "ends-with"].includes(
			obj["@_match-type"] as string,
		)
			? obj["@_match-type"]
			: "contains"
	) as TextMatch["matchType"];
	const negate = obj["@_negate-condition"] === "yes";
	return { value, collation, matchType, negate };
};

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

	// All text matches and param filters must pass for each matched property
	for (const prop of props) {
		const textOk = evalTextMatches(propValueText(prop), f.test, f.textMatches);
		if (!textOk) {
			return false;
		}
		for (const pf of f.paramFilters) {
			if (!evalParamFilter(prop, pf)) {
				return false;
			}
		}
	}
	return true;
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

const evalTextMatch = (text: string, tm: TextMatch): boolean => {
	const fold = (s: string) =>
		tm.collation === "i;unicode-casemap"
			? s.normalize("NFC").toLowerCase()
			: s.toLowerCase();
	const haystack = fold(text);
	const needle = fold(tm.value);

	let matches: boolean;
	switch (tm.matchType) {
		case "equals":
			matches = haystack === needle;
			break;
		case "contains":
			matches = haystack.includes(needle);
			break;
		case "starts-with":
			matches = haystack.startsWith(needle);
			break;
		case "ends-with":
			matches = haystack.endsWith(needle);
			break;
	}
	return tm.negate ? !matches : matches;
};

const propValueText = (prop: IrProperty): string => {
	const v = prop.value;
	if (v.type === "TEXT") {
		return v.value;
	}
	if ("value" in v && typeof v.value === "string") {
		return v.value;
	}
	return "";
};
