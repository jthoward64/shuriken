import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import type { IrDocument, IrProperty } from "#src/data/ir.ts";
import {
	type CardFilter,
	type CardPropFilter,
	evaluateCardFilter,
	parseCardFilter,
} from "./filter-card.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CarddavNs = "urn:ietf:params:xml:ns:carddav";
const cn = (l: string): string => `{${CarddavNs}}${l}`;

const textProp = (
	name: string,
	text: string,
	params?: Array<{ name: string; value: string }>,
): IrProperty => ({
	name,
	parameters: params ?? [],
	value: { type: "TEXT", value: text },
	isKnown: true,
});

const uriProp = (name: string, uri: string): IrProperty => ({
	name,
	parameters: [],
	value: { type: "URI", value: uri },
	isKnown: true,
});

const intProp = (name: string, n: number): IrProperty => ({
	name,
	parameters: [],
	value: { type: "INTEGER", value: n },
	isKnown: true,
});

const makeDoc = (properties: Array<IrProperty>): IrDocument => ({
	kind: "vcard",
	root: { name: "VCARD", properties, components: [] },
});

// ---------------------------------------------------------------------------
// parseCardFilter — invalid inputs
// ---------------------------------------------------------------------------

describe("parseCardFilter — invalid inputs", () => {
	it("fails when input is null", async () => {
		const result = await Effect.runPromise(
			Effect.either(parseCardFilter(null)),
		);
		expect(result._tag).toBe("Left");
	});

	it("fails when input is a string", async () => {
		const result = await Effect.runPromise(
			Effect.either(parseCardFilter("hello")),
		);
		expect(result._tag).toBe("Left");
	});

	it("fails when input is a number", async () => {
		const result = await Effect.runPromise(Effect.either(parseCardFilter(42)));
		expect(result._tag).toBe("Left");
	});

	it("fails when filter element is missing from the object", async () => {
		const result = await Effect.runPromise(
			Effect.either(parseCardFilter({ unrelated: {} })),
		);
		expect(result._tag).toBe("Left");
	});

	it("fails when filter element is null", async () => {
		const result = await Effect.runPromise(
			Effect.either(parseCardFilter({ [cn("filter")]: null })),
		);
		expect(result._tag).toBe("Left");
	});

	it("fails when filter element is a string", async () => {
		const result = await Effect.runPromise(
			Effect.either(parseCardFilter({ [cn("filter")]: "bad" })),
		);
		expect(result._tag).toBe("Left");
	});
});

// ---------------------------------------------------------------------------
// parseCardFilter — valid inputs
// ---------------------------------------------------------------------------

describe("parseCardFilter — valid inputs", () => {
	it("parses empty filter (no prop-filters) with default test=allof", async () => {
		const result = await Effect.runPromise(
			parseCardFilter({ [cn("filter")]: {} }),
		);
		expect(result.test).toBe("allof");
		expect(result.propFilters).toEqual([]);
	});

	it("parses test=anyof from @_test attribute", async () => {
		const result = await Effect.runPromise(
			parseCardFilter({ [cn("filter")]: { "@_test": "anyof" } }),
		);
		expect(result.test).toBe("anyof");
	});

	it("defaults to allof for unknown @_test value", async () => {
		const result = await Effect.runPromise(
			parseCardFilter({ [cn("filter")]: { "@_test": "garbage" } }),
		);
		expect(result.test).toBe("allof");
	});

	it("parses a single prop-filter with name and defaults", async () => {
		const result = await Effect.runPromise(
			parseCardFilter({
				[cn("filter")]: {
					[cn("prop-filter")]: { "@_name": "FN" },
				},
			}),
		);
		expect(result.propFilters).toHaveLength(1);
		const pf = result.propFilters[0];
		expect(pf?.name).toBe("FN");
		expect(pf?.test).toBe("allof");
		expect(pf?.isNotDefined).toBe(false);
		expect(pf?.textMatches).toEqual([]);
		expect(pf?.paramFilters).toEqual([]);
	});

	it("parses multiple prop-filters from array", async () => {
		const result = await Effect.runPromise(
			parseCardFilter({
				[cn("filter")]: {
					[cn("prop-filter")]: [
						{ "@_name": "FN" },
						{ "@_name": "EMAIL" },
						{ "@_name": "TEL" },
					],
				},
			}),
		);
		expect(result.propFilters).toHaveLength(3);
		expect(result.propFilters[0]?.name).toBe("FN");
		expect(result.propFilters[1]?.name).toBe("EMAIL");
		expect(result.propFilters[2]?.name).toBe("TEL");
	});

	it("parses is-not-defined inside prop-filter", async () => {
		const result = await Effect.runPromise(
			parseCardFilter({
				[cn("filter")]: {
					[cn("prop-filter")]: {
						"@_name": "X-CUSTOM",
						[cn("is-not-defined")]: {},
					},
				},
			}),
		);
		expect(result.propFilters[0]?.isNotDefined).toBe(true);
	});

	it("parses prop-filter test=anyof", async () => {
		const result = await Effect.runPromise(
			parseCardFilter({
				[cn("filter")]: {
					[cn("prop-filter")]: {
						"@_name": "EMAIL",
						"@_test": "anyof",
					},
				},
			}),
		);
		expect(result.propFilters[0]?.test).toBe("anyof");
	});

	it("parses text-match with all attributes", async () => {
		const result = await Effect.runPromise(
			parseCardFilter({
				[cn("filter")]: {
					[cn("prop-filter")]: {
						"@_name": "FN",
						[cn("text-match")]: {
							"#text": "Alice",
							"@_collation": "i;unicode-casemap",
							"@_match-type": "starts-with",
							"@_negate-condition": "yes",
						},
					},
				},
			}),
		);
		const tm = result.propFilters[0]?.textMatches[0];
		expect(tm?.value).toBe("Alice");
		expect(tm?.collation).toBe("i;unicode-casemap");
		expect(tm?.matchType).toBe("starts-with");
		expect(tm?.negate).toBe(true);
	});

	it("parses text-match defaults (ascii-casemap, contains, no negate)", async () => {
		const result = await Effect.runPromise(
			parseCardFilter({
				[cn("filter")]: {
					[cn("prop-filter")]: {
						"@_name": "NOTE",
						[cn("text-match")]: { "#text": "hello" },
					},
				},
			}),
		);
		const tm = result.propFilters[0]?.textMatches[0];
		expect(tm?.collation).toBe("i;ascii-casemap");
		expect(tm?.matchType).toBe("contains");
		expect(tm?.negate).toBe(false);
	});

	it("parses text-match with invalid match-type as contains", async () => {
		const result = await Effect.runPromise(
			parseCardFilter({
				[cn("filter")]: {
					[cn("prop-filter")]: {
						"@_name": "FN",
						[cn("text-match")]: {
							"#text": "x",
							"@_match-type": "fuzzy",
						},
					},
				},
			}),
		);
		expect(result.propFilters[0]?.textMatches[0]?.matchType).toBe("contains");
	});

	it("parses all four match types", async () => {
		for (const matchType of [
			"equals",
			"contains",
			"starts-with",
			"ends-with",
		] as const) {
			const result = await Effect.runPromise(
				parseCardFilter({
					[cn("filter")]: {
						[cn("prop-filter")]: {
							"@_name": "FN",
							[cn("text-match")]: { "#text": "x", "@_match-type": matchType },
						},
					},
				}),
			);
			expect(result.propFilters[0]?.textMatches[0]?.matchType).toBe(matchType);
		}
	});

	it("parses multiple text-matches as array", async () => {
		const result = await Effect.runPromise(
			parseCardFilter({
				[cn("filter")]: {
					[cn("prop-filter")]: {
						"@_name": "FN",
						[cn("text-match")]: [
							{ "#text": "Alice" },
							{ "#text": "Bob", "@_match-type": "ends-with" },
						],
					},
				},
			}),
		);
		expect(result.propFilters[0]?.textMatches).toHaveLength(2);
		expect(result.propFilters[0]?.textMatches[0]?.value).toBe("Alice");
		expect(result.propFilters[0]?.textMatches[1]?.value).toBe("Bob");
		expect(result.propFilters[0]?.textMatches[1]?.matchType).toBe("ends-with");
	});

	it("parses param-filter with is-not-defined", async () => {
		const result = await Effect.runPromise(
			parseCardFilter({
				[cn("filter")]: {
					[cn("prop-filter")]: {
						"@_name": "EMAIL",
						[cn("param-filter")]: {
							"@_name": "TYPE",
							[cn("is-not-defined")]: {},
						},
					},
				},
			}),
		);
		const paramFilter = result.propFilters[0]?.paramFilters[0];
		expect(paramFilter?.name).toBe("TYPE");
		expect(paramFilter?.isNotDefined).toBe(true);
		expect(paramFilter?.textMatch).toBeUndefined();
	});

	it("parses param-filter with text-match", async () => {
		const result = await Effect.runPromise(
			parseCardFilter({
				[cn("filter")]: {
					[cn("prop-filter")]: {
						"@_name": "EMAIL",
						[cn("param-filter")]: {
							"@_name": "TYPE",
							[cn("text-match")]: { "#text": "work" },
						},
					},
				},
			}),
		);
		const paramFilter = result.propFilters[0]?.paramFilters[0];
		expect(paramFilter?.textMatch).toBeDefined();
		expect(paramFilter?.textMatch?.value).toBe("work");
	});

	it("parses multiple param-filters as array", async () => {
		const result = await Effect.runPromise(
			parseCardFilter({
				[cn("filter")]: {
					[cn("prop-filter")]: {
						"@_name": "EMAIL",
						[cn("param-filter")]: [
							{ "@_name": "TYPE", [cn("text-match")]: { "#text": "work" } },
							{ "@_name": "PREF", [cn("is-not-defined")]: {} },
						],
					},
				},
			}),
		);
		expect(result.propFilters[0]?.paramFilters).toHaveLength(2);
		expect(result.propFilters[0]?.paramFilters[0]?.name).toBe("TYPE");
		expect(result.propFilters[0]?.paramFilters[1]?.name).toBe("PREF");
		expect(result.propFilters[0]?.paramFilters[1]?.isNotDefined).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// evaluateCardFilter
// ---------------------------------------------------------------------------

const allof = (propFilters: Array<CardPropFilter>): CardFilter => ({
	test: "allof",
	propFilters,
});

const anyof = (propFilters: Array<CardPropFilter>): CardFilter => ({
	test: "anyof",
	propFilters,
});

const propFilter = (
	name: string,
	opts?: Partial<Omit<CardPropFilter, "name">>,
): CardPropFilter => ({
	name,
	test: opts?.test ?? "allof",
	isNotDefined: opts?.isNotDefined,
	textMatches: opts?.textMatches ?? [],
	paramFilters: opts?.paramFilters ?? [],
});

const textMatch = (
	value: string,
	opts?: {
		collation?: "i;ascii-casemap" | "i;unicode-casemap";
		matchType?: "equals" | "contains" | "starts-with" | "ends-with";
		negate?: boolean;
	},
) => ({
	value,
	collation: opts?.collation ?? "i;ascii-casemap",
	matchType: opts?.matchType ?? "contains",
	negate: opts?.negate ?? false,
});

describe("evaluateCardFilter — filter-level logic", () => {
	it("returns true when there are no prop-filters", () => {
		expect(evaluateCardFilter(makeDoc([]), allof([]))).toBe(true);
		expect(evaluateCardFilter(makeDoc([]), anyof([]))).toBe(true);
	});

	it("allof: returns true when all prop-filters pass", () => {
		const doc = makeDoc([
			textProp("FN", "Alice"),
			textProp("EMAIL", "a@b.com"),
		]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("FN", { textMatches: [textMatch("Alice")] }),
					propFilter("EMAIL", { textMatches: [textMatch("a@b.com")] }),
				]),
			),
		).toBe(true);
	});

	it("allof: returns false when any prop-filter fails", () => {
		const doc = makeDoc([
			textProp("FN", "Alice"),
			textProp("EMAIL", "a@b.com"),
		]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("FN", { textMatches: [textMatch("Alice")] }),
					propFilter("EMAIL", { textMatches: [textMatch("wrong@x.com")] }),
				]),
			),
		).toBe(false);
	});

	it("anyof: returns true when any prop-filter passes", () => {
		const doc = makeDoc([textProp("FN", "Alice")]);
		expect(
			evaluateCardFilter(
				doc,
				anyof([
					propFilter("FN", { textMatches: [textMatch("Alice")] }),
					propFilter("EMAIL", { textMatches: [textMatch("a@b.com")] }),
				]),
			),
		).toBe(true);
	});

	it("anyof: returns false when no prop-filter passes", () => {
		const doc = makeDoc([textProp("FN", "Alice")]);
		expect(
			evaluateCardFilter(
				doc,
				anyof([
					propFilter("FN", { textMatches: [textMatch("Bob")] }),
					propFilter("EMAIL", { textMatches: [textMatch("x@y.com")] }),
				]),
			),
		).toBe(false);
	});
});

describe("evaluateCardFilter — prop-filter", () => {
	it("is-not-defined: returns true when property is absent", () => {
		const doc = makeDoc([textProp("FN", "Alice")]);
		expect(
			evaluateCardFilter(
				doc,
				allof([propFilter("X-CUSTOM", { isNotDefined: true })]),
			),
		).toBe(true);
	});

	it("is-not-defined: returns false when property is present", () => {
		const doc = makeDoc([textProp("X-CUSTOM", "value")]);
		expect(
			evaluateCardFilter(
				doc,
				allof([propFilter("X-CUSTOM", { isNotDefined: true })]),
			),
		).toBe(false);
	});

	it("returns false when required property is absent (no text-matches)", () => {
		const doc = makeDoc([textProp("FN", "Alice")]);
		expect(evaluateCardFilter(doc, allof([propFilter("EMAIL")]))).toBe(false);
	});

	it("returns true when property exists and no text-matches or param-filters", () => {
		const doc = makeDoc([textProp("FN", "Alice")]);
		expect(evaluateCardFilter(doc, allof([propFilter("FN")]))).toBe(true);
	});

	it("matches property name case-insensitively", () => {
		const doc = makeDoc([textProp("fn", "Alice")]);
		expect(evaluateCardFilter(doc, allof([propFilter("FN")]))).toBe(true);
	});

	it("text-match equals: passes when value matches exactly (case-folded)", () => {
		const doc = makeDoc([textProp("FN", "Alice Smith")]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("FN", {
						textMatches: [textMatch("alice smith", { matchType: "equals" })],
					}),
				]),
			),
		).toBe(true);
	});

	it("text-match equals: fails when value differs", () => {
		const doc = makeDoc([textProp("FN", "Alice Smith")]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("FN", {
						textMatches: [textMatch("Alice", { matchType: "equals" })],
					}),
				]),
			),
		).toBe(false);
	});

	it("text-match contains: passes when substring found", () => {
		const doc = makeDoc([textProp("FN", "Alice Smith")]);
		expect(
			evaluateCardFilter(
				doc,
				allof([propFilter("FN", { textMatches: [textMatch("smith")] })]),
			),
		).toBe(true);
	});

	it("text-match contains: fails when substring not found", () => {
		const doc = makeDoc([textProp("FN", "Alice Smith")]);
		expect(
			evaluateCardFilter(
				doc,
				allof([propFilter("FN", { textMatches: [textMatch("Jones")] })]),
			),
		).toBe(false);
	});

	it("text-match starts-with: passes when value starts with prefix", () => {
		const doc = makeDoc([textProp("FN", "Alice Smith")]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("FN", {
						textMatches: [textMatch("alice", { matchType: "starts-with" })],
					}),
				]),
			),
		).toBe(true);
	});

	it("text-match starts-with: fails when value does not start with prefix", () => {
		const doc = makeDoc([textProp("FN", "Alice Smith")]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("FN", {
						textMatches: [textMatch("smith", { matchType: "starts-with" })],
					}),
				]),
			),
		).toBe(false);
	});

	it("text-match ends-with: passes when value ends with suffix", () => {
		const doc = makeDoc([textProp("FN", "Alice Smith")]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("FN", {
						textMatches: [textMatch("smith", { matchType: "ends-with" })],
					}),
				]),
			),
		).toBe(true);
	});

	it("text-match ends-with: fails when value does not end with suffix", () => {
		const doc = makeDoc([textProp("FN", "Alice Smith")]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("FN", {
						textMatches: [textMatch("alice", { matchType: "ends-with" })],
					}),
				]),
			),
		).toBe(false);
	});

	it("text-match negate: inverts result", () => {
		const doc = makeDoc([textProp("FN", "Alice Smith")]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("FN", {
						textMatches: [textMatch("alice", { negate: true })],
					}),
				]),
			),
		).toBe(false);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("FN", {
						textMatches: [textMatch("Jones", { negate: true })],
					}),
				]),
			),
		).toBe(true);
	});

	it("text-match unicode-casemap: folds unicode casing", () => {
		const doc = makeDoc([textProp("FN", "Ünïcödé")]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("FN", {
						textMatches: [
							textMatch("ünïcödé", {
								matchType: "equals",
								collation: "i;unicode-casemap",
							}),
						],
					}),
				]),
			),
		).toBe(true);
	});

	it("prop-filter allof text-matches: all must pass", () => {
		const doc = makeDoc([textProp("EMAIL", "alice@example.com")]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("EMAIL", {
						test: "allof",
						textMatches: [textMatch("alice"), textMatch("example.com")],
					}),
				]),
			),
		).toBe(true);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("EMAIL", {
						test: "allof",
						textMatches: [textMatch("alice"), textMatch("other.com")],
					}),
				]),
			),
		).toBe(false);
	});

	it("prop-filter anyof text-matches: any must pass", () => {
		const doc = makeDoc([textProp("EMAIL", "alice@example.com")]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("EMAIL", {
						test: "anyof",
						textMatches: [textMatch("alice"), textMatch("bob")],
					}),
				]),
			),
		).toBe(true);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("EMAIL", {
						test: "anyof",
						textMatches: [textMatch("bob"), textMatch("charlie")],
					}),
				]),
			),
		).toBe(false);
	});

	it("multiple properties with same name — all must pass text-matches", () => {
		// Both FN values must satisfy the filter
		const doc = makeDoc([
			textProp("EMAIL", "alice@example.com"),
			textProp("EMAIL", "alice@work.org"),
		]);
		// "alice" appears in both — passes
		expect(
			evaluateCardFilter(
				doc,
				allof([propFilter("EMAIL", { textMatches: [textMatch("alice")] })]),
			),
		).toBe(true);
		// "example" only in first — fails (second must also match)
		expect(
			evaluateCardFilter(
				doc,
				allof([propFilter("EMAIL", { textMatches: [textMatch("example")] })]),
			),
		).toBe(false);
	});
});

describe("evaluateCardFilter — param-filter", () => {
	it("is-not-defined: returns true when param absent", () => {
		const doc = makeDoc([textProp("EMAIL", "a@b.com")]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("EMAIL", {
						paramFilters: [{ name: "TYPE", isNotDefined: true }],
					}),
				]),
			),
		).toBe(true);
	});

	it("is-not-defined: returns false when param present", () => {
		const doc = makeDoc([
			textProp("EMAIL", "a@b.com", [{ name: "TYPE", value: "work" }]),
		]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("EMAIL", {
						paramFilters: [{ name: "TYPE", isNotDefined: true }],
					}),
				]),
			),
		).toBe(false);
	});

	it("returns false when param required but absent", () => {
		const doc = makeDoc([textProp("EMAIL", "a@b.com")]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("EMAIL", {
						paramFilters: [{ name: "TYPE" }],
					}),
				]),
			),
		).toBe(false);
	});

	it("returns true when param exists (no text-match)", () => {
		const doc = makeDoc([
			textProp("EMAIL", "a@b.com", [{ name: "TYPE", value: "work" }]),
		]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("EMAIL", {
						paramFilters: [{ name: "TYPE" }],
					}),
				]),
			),
		).toBe(true);
	});

	it("param name matched case-insensitively", () => {
		const doc = makeDoc([
			textProp("EMAIL", "a@b.com", [{ name: "type", value: "work" }]),
		]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("EMAIL", {
						paramFilters: [{ name: "TYPE" }],
					}),
				]),
			),
		).toBe(true);
	});

	it("param text-match passes when param value matches", () => {
		const doc = makeDoc([
			textProp("EMAIL", "a@b.com", [{ name: "TYPE", value: "work" }]),
		]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("EMAIL", {
						paramFilters: [
							{
								name: "TYPE",
								textMatch: textMatch("work", { matchType: "equals" }),
							},
						],
					}),
				]),
			),
		).toBe(true);
	});

	it("param text-match fails when param value does not match", () => {
		const doc = makeDoc([
			textProp("EMAIL", "a@b.com", [{ name: "TYPE", value: "home" }]),
		]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("EMAIL", {
						paramFilters: [
							{
								name: "TYPE",
								textMatch: textMatch("work", { matchType: "equals" }),
							},
						],
					}),
				]),
			),
		).toBe(false);
	});

	it("param text-match: any param value matching is sufficient", () => {
		// Multiple TYPE params — at least one must match
		const doc = makeDoc([
			textProp("EMAIL", "a@b.com", [
				{ name: "TYPE", value: "home" },
				{ name: "TYPE", value: "work" },
			]),
		]);
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("EMAIL", {
						paramFilters: [
							{
								name: "TYPE",
								textMatch: textMatch("work", { matchType: "equals" }),
							},
						],
					}),
				]),
			),
		).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// propValueText — internal coverage via evaluation
// ---------------------------------------------------------------------------

describe("evaluateCardFilter — propValueText coverage", () => {
	it("extracts text from URI property value (has string .value)", () => {
		const doc: IrDocument = {
			kind: "vcard",
			root: {
				name: "VCARD",
				properties: [uriProp("URL", "https://example.com")],
				components: [],
			},
		};
		expect(
			evaluateCardFilter(
				doc,
				allof([propFilter("URL", { textMatches: [textMatch("example.com")] })]),
			),
		).toBe(true);
	});

	it("returns empty string for BINARY property value (Uint8Array, not string)", () => {
		const doc: IrDocument = {
			kind: "vcard",
			root: {
				name: "VCARD",
				properties: [
					{
						name: "PHOTO",
						parameters: [],
						value: { type: "BINARY", value: new Uint8Array([1, 2, 3]) },
						isKnown: true,
					},
				],
				components: [],
			},
		};
		// Empty string matches "contains" empty string → prop filter passes
		expect(
			evaluateCardFilter(
				doc,
				allof([propFilter("PHOTO", { textMatches: [textMatch("")] })]),
			),
		).toBe(true);
		// Non-empty match will fail since propValueText returns ""
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("PHOTO", {
						textMatches: [textMatch("data", { matchType: "equals" })],
					}),
				]),
			),
		).toBe(false);
	});

	it("extracts text from INTEGER property value", () => {
		const doc: IrDocument = {
			kind: "vcard",
			root: {
				name: "VCARD",
				properties: [intProp("X-PRIORITY", 42)],
				components: [],
			},
		};
		// INTEGER value is a number, not string — propValueText returns "" for non-string .value
		expect(
			evaluateCardFilter(
				doc,
				allof([
					propFilter("X-PRIORITY", {
						textMatches: [textMatch("42", { matchType: "equals" })],
					}),
				]),
			),
		).toBe(false);
	});
});
