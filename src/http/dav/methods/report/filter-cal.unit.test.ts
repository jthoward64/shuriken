import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import type { IrComponent, IrDocument, IrProperty } from "#src/data/ir.ts";
import {
	type CalFilter,
	type CompFilter,
	evaluateCalFilter,
	parseCalFilter,
} from "./filter-cal.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

const dtProp = (name: string, epochMs: number): IrProperty => ({
	name,
	parameters: [],
	value: {
		type: "DATE_TIME",
		value:
			Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO("UTC"),
	},
	isKnown: true,
});

const dateProp = (name: string, isoDate: string): IrProperty => ({
	name,
	parameters: [],
	value: { type: "DATE", value: Temporal.PlainDate.from(isoDate) },
	isKnown: true,
});

const makeComponent = (
	name: string,
	properties: Array<IrProperty> = [],
	components: Array<IrComponent> = [],
): IrComponent => ({ name, properties, components });

const makeDoc = (
	events: Array<IrComponent> = [],
	extraProps: Array<IrProperty> = [],
): IrDocument => ({
	kind: "icalendar",
	root: makeComponent("VCALENDAR", extraProps, events),
});

// Epoch times for January 15, 2026
const T_JAN15_09 = Temporal.Instant.from(
	"2026-01-15T09:00:00Z",
).epochMilliseconds;
const T_JAN15_10 = Temporal.Instant.from(
	"2026-01-15T10:00:00Z",
).epochMilliseconds;
const T_JAN15_11 = Temporal.Instant.from(
	"2026-01-15T11:00:00Z",
).epochMilliseconds;
const T_JAN15_12 = Temporal.Instant.from(
	"2026-01-15T12:00:00Z",
).epochMilliseconds;

// ---------------------------------------------------------------------------
// parseCalFilter — invalid inputs
// ---------------------------------------------------------------------------

describe("parseCalFilter — invalid inputs", () => {
	it("fails with CALDAV:valid-filter when tree is null", async () => {
		const result = await Effect.runPromise(Effect.either(parseCalFilter(null)));
		expect(result._tag).toBe("Left");
	});

	it("fails when tree is not an object", async () => {
		const result = await Effect.runPromise(
			Effect.either(parseCalFilter("bad")),
		);
		expect(result._tag).toBe("Left");
	});

	it("fails when filter element is missing", async () => {
		const result = await Effect.runPromise(Effect.either(parseCalFilter({})));
		expect(result._tag).toBe("Left");
	});

	it("fails when comp-filter is missing inside filter", async () => {
		const CaldavNs = "urn:ietf:params:xml:ns:caldav";
		const cn = (l: string) => `{${CaldavNs}}${l}`;
		const result = await Effect.runPromise(
			Effect.either(parseCalFilter({ [cn("filter")]: {} })),
		);
		expect(result._tag).toBe("Left");
	});

	it("fails when filter element is a string (not object)", async () => {
		const CaldavNs = "urn:ietf:params:xml:ns:caldav";
		const cn = (l: string) => `{${CaldavNs}}${l}`;
		const result = await Effect.runPromise(
			Effect.either(parseCalFilter({ [cn("filter")]: "bad" })),
		);
		expect(result._tag).toBe("Left");
	});
});

// ---------------------------------------------------------------------------
// parseCalFilter — valid inputs
// ---------------------------------------------------------------------------

describe("parseCalFilter — valid inputs", () => {
	const CaldavNs = "urn:ietf:params:xml:ns:caldav";
	const cn = (l: string) => `{${CaldavNs}}${l}`;

	const makeTree = (compFilter: unknown) => ({
		[cn("filter")]: { [cn("comp-filter")]: compFilter },
	});

	it("parses a minimal VCALENDAR comp-filter", async () => {
		const result = await Effect.runPromise(
			parseCalFilter(makeTree({ "@_name": "VCALENDAR" })),
		);
		expect(result.compFilter.name).toBe("VCALENDAR");
		expect(result.compFilter.isNotDefined).toBe(false);
		expect(result.compFilter.propFilters).toHaveLength(0);
		expect(result.compFilter.compFilters).toHaveLength(0);
	});

	it("parses is-not-defined on a comp-filter", async () => {
		const result = await Effect.runPromise(
			parseCalFilter(
				makeTree({ "@_name": "VEVENT", [cn("is-not-defined")]: "" }),
			),
		);
		expect(result.compFilter.isNotDefined).toBe(true);
	});

	it("parses a time-range on a comp-filter", async () => {
		const result = await Effect.runPromise(
			parseCalFilter(
				makeTree({
					"@_name": "VCALENDAR",
					[cn("comp-filter")]: {
						"@_name": "VEVENT",
						[cn("time-range")]: {
							"@_start": "2026-01-15T10:00:00Z",
							"@_end": "2026-01-15T11:00:00Z",
						},
					},
				}),
			),
		);
		const vevent = result.compFilter.compFilters[0];
		expect(vevent?.timeRange?.start?.epochMilliseconds).toBe(T_JAN15_10);
		expect(vevent?.timeRange?.end?.epochMilliseconds).toBe(T_JAN15_11);
	});

	it("parses prop-filter with text-match (contains, unicode-casemap)", async () => {
		const result = await Effect.runPromise(
			parseCalFilter(
				makeTree({
					"@_name": "VCALENDAR",
					[cn("comp-filter")]: {
						"@_name": "VEVENT",
						[cn("prop-filter")]: {
							"@_name": "SUMMARY",
							[cn("text-match")]: {
								"#text": "meeting",
								"@_collation": "i;unicode-casemap",
								"@_match-type": "contains",
								"@_negate-condition": "no",
							},
						},
					},
				}),
			),
		);
		const pf = result.compFilter.compFilters[0]?.propFilters[0];
		expect(pf?.name).toBe("SUMMARY");
		expect(pf?.textMatch?.value).toBe("meeting");
		expect(pf?.textMatch?.collation).toBe("i;unicode-casemap");
		expect(pf?.textMatch?.matchType).toBe("contains");
		expect(pf?.textMatch?.negate).toBe(false);
	});

	it("parses text-match negate-condition=yes", async () => {
		const result = await Effect.runPromise(
			parseCalFilter(
				makeTree({
					"@_name": "VCALENDAR",
					[cn("comp-filter")]: {
						"@_name": "VEVENT",
						[cn("prop-filter")]: {
							"@_name": "SUMMARY",
							[cn("text-match")]: {
								"#text": "holiday",
								"@_negate-condition": "yes",
							},
						},
					},
				}),
			),
		);
		const pf = result.compFilter.compFilters[0]?.propFilters[0];
		expect(pf?.textMatch?.negate).toBe(true);
	});

	it("parses text-match match-type defaults to contains for unknown values", async () => {
		const result = await Effect.runPromise(
			parseCalFilter(
				makeTree({
					"@_name": "VCALENDAR",
					[cn("comp-filter")]: {
						"@_name": "VEVENT",
						[cn("prop-filter")]: {
							"@_name": "SUMMARY",
							[cn("text-match")]: { "#text": "foo", "@_match-type": "unknown" },
						},
					},
				}),
			),
		);
		expect(
			result.compFilter.compFilters[0]?.propFilters[0]?.textMatch?.matchType,
		).toBe("contains");
	});

	it("parses prop-filter with starts-with and ends-with match types", async () => {
		const tree = (matchType: string) =>
			makeTree({
				"@_name": "VCALENDAR",
				[cn("comp-filter")]: {
					"@_name": "VEVENT",
					[cn("prop-filter")]: {
						"@_name": "SUMMARY",
						[cn("text-match")]: { "#text": "val", "@_match-type": matchType },
					},
				},
			});

		const r1 = await Effect.runPromise(parseCalFilter(tree("starts-with")));
		expect(
			r1.compFilter.compFilters[0]?.propFilters[0]?.textMatch?.matchType,
		).toBe("starts-with");

		const r2 = await Effect.runPromise(parseCalFilter(tree("ends-with")));
		expect(
			r2.compFilter.compFilters[0]?.propFilters[0]?.textMatch?.matchType,
		).toBe("ends-with");

		const r3 = await Effect.runPromise(parseCalFilter(tree("equals")));
		expect(
			r3.compFilter.compFilters[0]?.propFilters[0]?.textMatch?.matchType,
		).toBe("equals");
	});

	it("parses prop-filter with is-not-defined", async () => {
		const result = await Effect.runPromise(
			parseCalFilter(
				makeTree({
					"@_name": "VCALENDAR",
					[cn("comp-filter")]: {
						"@_name": "VEVENT",
						[cn("prop-filter")]: {
							"@_name": "LOCATION",
							[cn("is-not-defined")]: "",
						},
					},
				}),
			),
		);
		expect(result.compFilter.compFilters[0]?.propFilters[0]?.isNotDefined).toBe(
			true,
		);
	});

	it("parses param-filter with is-not-defined", async () => {
		const result = await Effect.runPromise(
			parseCalFilter(
				makeTree({
					"@_name": "VCALENDAR",
					[cn("comp-filter")]: {
						"@_name": "VEVENT",
						[cn("prop-filter")]: {
							"@_name": "DTSTART",
							[cn("param-filter")]: {
								"@_name": "TZID",
								[cn("is-not-defined")]: "",
							},
						},
					},
				}),
			),
		);
		const paramFilter =
			result.compFilter.compFilters[0]?.propFilters[0]?.paramFilters[0];
		expect(paramFilter?.name).toBe("TZID");
		expect(paramFilter?.isNotDefined).toBe(true);
	});

	it("parses an array of prop-filters", async () => {
		const result = await Effect.runPromise(
			parseCalFilter(
				makeTree({
					"@_name": "VCALENDAR",
					[cn("comp-filter")]: {
						"@_name": "VEVENT",
						[cn("prop-filter")]: [
							{ "@_name": "SUMMARY" },
							{ "@_name": "DESCRIPTION" },
						],
					},
				}),
			),
		);
		expect(result.compFilter.compFilters[0]?.propFilters).toHaveLength(2);
	});

	it("ignores time-range when only start or only end is present", async () => {
		const result = await Effect.runPromise(
			parseCalFilter(
				makeTree({
					"@_name": "VCALENDAR",
					[cn("comp-filter")]: {
						"@_name": "VEVENT",
						[cn("time-range")]: { "@_start": "2026-01-15T10:00:00Z" },
					},
				}),
			),
		);
		// time-range with only start → start is present, end is undefined
		expect(result.compFilter.compFilters[0]?.timeRange?.start).toBeDefined();
		expect(result.compFilter.compFilters[0]?.timeRange?.end).toBeUndefined();
	});

	it("returns undefined for time-range when both start and end are missing", async () => {
		const result = await Effect.runPromise(
			parseCalFilter(
				makeTree({
					"@_name": "VCALENDAR",
					[cn("comp-filter")]: {
						"@_name": "VEVENT",
						[cn("time-range")]: {},
					},
				}),
			),
		);
		expect(result.compFilter.compFilters[0]?.timeRange).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// evaluateCalFilter — comp-filter matching
// ---------------------------------------------------------------------------

describe("evaluateCalFilter — comp-filter matching", () => {
	const makeFilter = (comp: CompFilter): CalFilter => ({ compFilter: comp });

	it("matches when VCALENDAR has a VEVENT child (simple child lookup)", () => {
		const doc = makeDoc([makeComponent("VEVENT")]);
		const filter = makeFilter({
			name: "VCALENDAR",
			propFilters: [],
			compFilters: [{ name: "VEVENT", propFilters: [], compFilters: [] }],
		});
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});

	it("does not match when VEVENT child is absent", () => {
		const doc = makeDoc([]); // no events
		const filter = makeFilter({
			name: "VCALENDAR",
			propFilters: [],
			compFilters: [{ name: "VEVENT", propFilters: [], compFilters: [] }],
		});
		expect(evaluateCalFilter(doc, filter)).toBe(false);
	});

	it("is-not-defined on comp-filter: false when component exists", () => {
		const doc = makeDoc([makeComponent("VEVENT")]);
		const filter = makeFilter({
			name: "VCALENDAR",
			propFilters: [],
			compFilters: [
				{
					name: "VEVENT",
					isNotDefined: true,
					propFilters: [],
					compFilters: [],
				},
			],
		});
		expect(evaluateCalFilter(doc, filter)).toBe(false);
	});

	it("is-not-defined on comp-filter: true when component absent", () => {
		const doc = makeDoc([]); // no VEVENT
		const filter = makeFilter({
			name: "VCALENDAR",
			propFilters: [],
			compFilters: [
				{
					name: "VEVENT",
					isNotDefined: true,
					propFilters: [],
					compFilters: [],
				},
			],
		});
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});

	it("comp-filter on wrong component name falls through to children", () => {
		// filter.name = "VEVENT" but root.name = "VCALENDAR" → checks children
		const doc = makeDoc([makeComponent("VEVENT")]);
		const filter = makeFilter({
			name: "VEVENT", // matches child, not root
			propFilters: [],
			compFilters: [],
		});
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// evaluateCalFilter — prop-filter matching
// ---------------------------------------------------------------------------

describe("evaluateCalFilter — prop-filter matching", () => {
	const makeFilter = (
		propFilters: CalFilter["compFilter"]["propFilters"],
	): CalFilter => ({
		compFilter: {
			name: "VCALENDAR",
			propFilters: [],
			compFilters: [{ name: "VEVENT", propFilters, compFilters: [] }],
		},
	});

	it("text-match contains: matches when value is a substring", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [textProp("SUMMARY", "Team Meeting")]),
		]);
		const filter = makeFilter([
			{
				name: "SUMMARY",
				paramFilters: [],
				textMatch: {
					value: "meeting",
					collation: "i;ascii-casemap",
					matchType: "contains",
					negate: false,
				},
			},
		]);
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});

	it("text-match contains: case-insensitive", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [textProp("SUMMARY", "TEAM MEETING")]),
		]);
		const filter = makeFilter([
			{
				name: "SUMMARY",
				paramFilters: [],
				textMatch: {
					value: "team",
					collation: "i;ascii-casemap",
					matchType: "contains",
					negate: false,
				},
			},
		]);
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});

	it("text-match equals: exact match", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [textProp("SUMMARY", "Meeting")]),
		]);
		const filter = makeFilter([
			{
				name: "SUMMARY",
				paramFilters: [],
				textMatch: {
					value: "meeting",
					collation: "i;ascii-casemap",
					matchType: "equals",
					negate: false,
				},
			},
		]);
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});

	it("text-match equals: fails when not equal", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [textProp("SUMMARY", "Not Meeting")]),
		]);
		const filter = makeFilter([
			{
				name: "SUMMARY",
				paramFilters: [],
				textMatch: {
					value: "meeting",
					collation: "i;ascii-casemap",
					matchType: "equals",
					negate: false,
				},
			},
		]);
		expect(evaluateCalFilter(doc, filter)).toBe(false);
	});

	it("text-match starts-with: matches prefix", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [textProp("SUMMARY", "Weekly Standup")]),
		]);
		const filter = makeFilter([
			{
				name: "SUMMARY",
				paramFilters: [],
				textMatch: {
					value: "weekly",
					collation: "i;ascii-casemap",
					matchType: "starts-with",
					negate: false,
				},
			},
		]);
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});

	it("text-match ends-with: matches suffix", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [textProp("SUMMARY", "Weekly Standup")]),
		]);
		const filter = makeFilter([
			{
				name: "SUMMARY",
				paramFilters: [],
				textMatch: {
					value: "standup",
					collation: "i;ascii-casemap",
					matchType: "ends-with",
					negate: false,
				},
			},
		]);
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});

	it("text-match negated: fails when value does match", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [textProp("SUMMARY", "Meeting")]),
		]);
		const filter = makeFilter([
			{
				name: "SUMMARY",
				paramFilters: [],
				textMatch: {
					value: "meeting",
					collation: "i;ascii-casemap",
					matchType: "contains",
					negate: true,
				},
			},
		]);
		expect(evaluateCalFilter(doc, filter)).toBe(false);
	});

	it("text-match negated: passes when value does not match", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [textProp("SUMMARY", "Holiday")]),
		]);
		const filter = makeFilter([
			{
				name: "SUMMARY",
				paramFilters: [],
				textMatch: {
					value: "meeting",
					collation: "i;ascii-casemap",
					matchType: "contains",
					negate: true,
				},
			},
		]);
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});

	it("text-match unicode-casemap: normalizes NFC before comparing", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [textProp("SUMMARY", "Réunion")]),
		]);
		const filter = makeFilter([
			{
				name: "SUMMARY",
				paramFilters: [],
				textMatch: {
					value: "réunion",
					collation: "i;unicode-casemap",
					matchType: "contains",
					negate: false,
				},
			},
		]);
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});

	it("prop-filter is-not-defined: passes when property is absent", () => {
		const doc = makeDoc([makeComponent("VEVENT")]);
		const filter = makeFilter([
			{
				name: "LOCATION",
				isNotDefined: true,
				paramFilters: [],
			},
		]);
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});

	it("prop-filter is-not-defined: fails when property is present", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [textProp("LOCATION", "Conference Room")]),
		]);
		const filter = makeFilter([
			{
				name: "LOCATION",
				isNotDefined: true,
				paramFilters: [],
			},
		]);
		expect(evaluateCalFilter(doc, filter)).toBe(false);
	});

	it("prop-filter: fails when property is absent (no is-not-defined)", () => {
		const doc = makeDoc([makeComponent("VEVENT")]);
		const filter = makeFilter([{ name: "SUMMARY", paramFilters: [] }]);
		expect(evaluateCalFilter(doc, filter)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// evaluateCalFilter — param-filter matching
// ---------------------------------------------------------------------------

describe("evaluateCalFilter — param-filter matching", () => {
	const makeFilter = (
		paramFilters: CalFilter["compFilter"]["propFilters"][0]["paramFilters"],
	): CalFilter => ({
		compFilter: {
			name: "VCALENDAR",
			propFilters: [],
			compFilters: [
				{
					name: "VEVENT",
					propFilters: [{ name: "DTSTART", paramFilters }],
					compFilters: [],
				},
			],
		},
	});

	it("is-not-defined: passes when parameter absent", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [textProp("DTSTART", "20260115T100000Z")]),
		]);
		const filter = makeFilter([{ name: "TZID", isNotDefined: true }]);
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});

	it("is-not-defined: fails when parameter present", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [
				textProp("DTSTART", "20260115T100000", [
					{ name: "TZID", value: "America/New_York" },
				]),
			]),
		]);
		const filter = makeFilter([{ name: "TZID", isNotDefined: true }]);
		expect(evaluateCalFilter(doc, filter)).toBe(false);
	});

	it("param exists (no text-match): passes when param is present", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [
				textProp("DTSTART", "20260115T100000", [
					{ name: "TZID", value: "UTC" },
				]),
			]),
		]);
		const filter = makeFilter([{ name: "TZID" }]);
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});

	it("param exists (no text-match): fails when param is absent", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [textProp("DTSTART", "20260115T100000Z")]),
		]);
		const filter = makeFilter([{ name: "TZID" }]);
		expect(evaluateCalFilter(doc, filter)).toBe(false);
	});

	it("param text-match: passes when param value matches", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [
				textProp("DTSTART", "20260115T100000", [
					{ name: "TZID", value: "America/New_York" },
				]),
			]),
		]);
		const filter = makeFilter([
			{
				name: "TZID",
				textMatch: {
					value: "america",
					collation: "i;ascii-casemap",
					matchType: "starts-with",
					negate: false,
				},
			},
		]);
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// evaluateCalFilter — time-range matching (RFC 4791 §9.9)
// ---------------------------------------------------------------------------

describe("evaluateCalFilter — time-range matching", () => {
	it("event overlapping the range passes", () => {
		const event = makeComponent("VEVENT", [
			dtProp("DTSTART", T_JAN15_10),
			dtProp("DTEND", T_JAN15_11),
		]);
		const doc = makeDoc([event]);
		const filter: CalFilter = {
			compFilter: {
				name: "VCALENDAR",
				propFilters: [],
				compFilters: [
					{
						name: "VEVENT",
						timeRange: {
							start: Temporal.Instant.fromEpochMilliseconds(T_JAN15_09),
							end: Temporal.Instant.fromEpochMilliseconds(T_JAN15_12),
						},
						propFilters: [],
						compFilters: [],
					},
				],
			},
		};
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});

	it("event before range start is excluded", () => {
		const event = makeComponent("VEVENT", [
			dtProp("DTSTART", T_JAN15_09),
			dtProp("DTEND", T_JAN15_10),
		]);
		const doc = makeDoc([event]);
		const filter: CalFilter = {
			compFilter: {
				name: "VCALENDAR",
				propFilters: [],
				compFilters: [
					{
						name: "VEVENT",
						timeRange: {
							start: Temporal.Instant.fromEpochMilliseconds(T_JAN15_11),
							end: Temporal.Instant.fromEpochMilliseconds(T_JAN15_12),
						},
						propFilters: [],
						compFilters: [],
					},
				],
			},
		};
		expect(evaluateCalFilter(doc, filter)).toBe(false);
	});

	it("event after range end is excluded", () => {
		const event = makeComponent("VEVENT", [
			dtProp("DTSTART", T_JAN15_11),
			dtProp("DTEND", T_JAN15_12),
		]);
		const doc = makeDoc([event]);
		const filter: CalFilter = {
			compFilter: {
				name: "VCALENDAR",
				propFilters: [],
				compFilters: [
					{
						name: "VEVENT",
						timeRange: {
							start: Temporal.Instant.fromEpochMilliseconds(T_JAN15_09),
							end: Temporal.Instant.fromEpochMilliseconds(T_JAN15_10),
						},
						propFilters: [],
						compFilters: [],
					},
				],
			},
		};
		expect(evaluateCalFilter(doc, filter)).toBe(false);
	});

	it("event without DTSTART passes conservatively (no DTSTART)", () => {
		const event = makeComponent("VEVENT", []); // no DTSTART
		const doc = makeDoc([event]);
		const filter: CalFilter = {
			compFilter: {
				name: "VCALENDAR",
				propFilters: [],
				compFilters: [
					{
						name: "VEVENT",
						timeRange: {
							start: Temporal.Instant.fromEpochMilliseconds(T_JAN15_11),
							end: Temporal.Instant.fromEpochMilliseconds(T_JAN15_12),
						},
						propFilters: [],
						compFilters: [],
					},
				],
			},
		};
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});

	it("event with only start range (no end): passes when event starts before range limit", () => {
		const event = makeComponent("VEVENT", [
			dtProp("DTSTART", T_JAN15_10),
			dtProp("DTEND", T_JAN15_11),
		]);
		const doc = makeDoc([event]);
		const filter: CalFilter = {
			compFilter: {
				name: "VCALENDAR",
				propFilters: [],
				compFilters: [
					{
						name: "VEVENT",
						timeRange: {
							start: Temporal.Instant.fromEpochMilliseconds(T_JAN15_09),
						},
						propFilters: [],
						compFilters: [],
					},
				],
			},
		};
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});

	it("event with only end range (no start): passes when event ends after range start", () => {
		const event = makeComponent("VEVENT", [
			dtProp("DTSTART", T_JAN15_10),
			dtProp("DTEND", T_JAN15_11),
		]);
		const doc = makeDoc([event]);
		const filter: CalFilter = {
			compFilter: {
				name: "VCALENDAR",
				propFilters: [],
				compFilters: [
					{
						name: "VEVENT",
						timeRange: {
							end: Temporal.Instant.fromEpochMilliseconds(T_JAN15_12),
						},
						propFilters: [],
						compFilters: [],
					},
				],
			},
		};
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});

	// RFC 4791 §9.9: event with DATE (all-day) DTSTART passes time-range if start falls in range
	it("all-day event (DATE value) overlapping range passes", () => {
		const event = makeComponent("VEVENT", [dateProp("DTSTART", "2026-01-15")]);
		const doc = makeDoc([event]);
		const filter: CalFilter = {
			compFilter: {
				name: "VCALENDAR",
				propFilters: [],
				compFilters: [
					{
						name: "VEVENT",
						timeRange: {
							start: Temporal.Instant.from("2026-01-14T00:00:00Z"),
							end: Temporal.Instant.from("2026-01-16T00:00:00Z"),
						},
						propFilters: [],
						compFilters: [],
					},
				],
			},
		};
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});

	// DTEND absent → use DTSTART as zero-duration point
	it("event without DTEND: treated as zero-duration (DTSTART only)", () => {
		const event = makeComponent("VEVENT", [dtProp("DTSTART", T_JAN15_10)]);
		const doc = makeDoc([event]);
		const filter: CalFilter = {
			compFilter: {
				name: "VCALENDAR",
				propFilters: [],
				compFilters: [
					{
						name: "VEVENT",
						timeRange: {
							start: Temporal.Instant.fromEpochMilliseconds(T_JAN15_09),
							end: Temporal.Instant.fromEpochMilliseconds(T_JAN15_11),
						},
						propFilters: [],
						compFilters: [],
					},
				],
			},
		};
		expect(evaluateCalFilter(doc, filter)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// propValueText — different IrValue types (via text-match on SUMMARY)
// ---------------------------------------------------------------------------

describe("evaluateCalFilter — propValueText covers multiple IrValue types", () => {
	const makeFilterForProp = (name: string): CalFilter => ({
		compFilter: {
			name: "VCALENDAR",
			propFilters: [],
			compFilters: [
				{
					name: "VEVENT",
					propFilters: [
						{
							name,
							paramFilters: [],
							textMatch: {
								value: "",
								collation: "i;ascii-casemap",
								matchType: "contains",
								negate: false,
							},
						},
					],
					compFilters: [],
				},
			],
		},
	});

	it("TEXT value is used as-is", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [textProp("SUMMARY", "hello")]),
		]);
		expect(evaluateCalFilter(doc, makeFilterForProp("SUMMARY"))).toBe(true);
	});

	it("INTEGER value is stringified", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [
				{
					name: "X-INT",
					parameters: [],
					value: { type: "INTEGER", value: 42 },
					isKnown: true,
				},
			]),
		]);
		expect(evaluateCalFilter(doc, makeFilterForProp("X-INT"))).toBe(true);
	});

	it("FLOAT value is stringified", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [
				{
					name: "X-FLOAT",
					parameters: [],
					value: { type: "FLOAT", value: 3.14 },
					isKnown: true,
				},
			]),
		]);
		expect(evaluateCalFilter(doc, makeFilterForProp("X-FLOAT"))).toBe(true);
	});

	it("BOOLEAN value is stringified", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [
				{
					name: "X-BOOL",
					parameters: [],
					value: { type: "BOOLEAN", value: true },
					isKnown: true,
				},
			]),
		]);
		expect(evaluateCalFilter(doc, makeFilterForProp("X-BOOL"))).toBe(true);
	});

	it("DATE value is stringified as ISO date", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [
				{
					name: "X-DATE",
					parameters: [],
					value: { type: "DATE", value: Temporal.PlainDate.from("2026-01-15") },
					isKnown: true,
				},
			]),
		]);
		expect(evaluateCalFilter(doc, makeFilterForProp("X-DATE"))).toBe(true);
	});

	it("DATE_TIME value is stringified", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [
				{
					name: "X-DT",
					parameters: [],
					value: {
						type: "DATE_TIME",
						value: Temporal.Instant.from(
							"2026-01-15T10:00:00Z",
						).toZonedDateTimeISO("UTC"),
					},
					isKnown: true,
				},
			]),
		]);
		expect(evaluateCalFilter(doc, makeFilterForProp("X-DT"))).toBe(true);
	});

	it("URI value (has string 'value') falls through to generic string path", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [
				{
					name: "URL",
					parameters: [],
					value: { type: "URI", value: "https://example.com" },
					isKnown: true,
				},
			]),
		]);
		expect(evaluateCalFilter(doc, makeFilterForProp("URL"))).toBe(true);
	});
});
