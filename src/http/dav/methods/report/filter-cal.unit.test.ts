import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Temporal } from "temporal-polyfill";
import { UTC } from "#src/data/icalendar/resolve-floating.ts";
import type { IrComponent, IrDocument, IrProperty } from "#src/data/ir.ts";
import {
	type CalFilter,
	type CompFilter,
	evaluateCalFilter,
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
	});

	it("does not match when VEVENT child is absent", () => {
		const doc = makeDoc([]); // no events
		const filter = makeFilter({
			name: "VCALENDAR",
			propFilters: [],
			compFilters: [{ name: "VEVENT", propFilters: [], compFilters: [] }],
		});
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(false);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(false);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
	});

	it("comp-filter on wrong component name falls through to children", () => {
		// filter.name = "VEVENT" but root.name = "VCALENDAR" → checks children
		const doc = makeDoc([makeComponent("VEVENT")]);
		const filter = makeFilter({
			name: "VEVENT", // matches child, not root
			propFilters: [],
			compFilters: [],
		});
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(false);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(false);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(false);
	});

	it("prop-filter: fails when property is absent (no is-not-defined)", () => {
		const doc = makeDoc([makeComponent("VEVENT")]);
		const filter = makeFilter([{ name: "SUMMARY", paramFilters: [] }]);
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(false);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(false);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
	});

	it("param exists (no text-match): fails when param is absent", () => {
		const doc = makeDoc([
			makeComponent("VEVENT", [textProp("DTSTART", "20260115T100000Z")]),
		]);
		const filter = makeFilter([{ name: "TZID" }]);
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(false);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, makeFilterForProp("SUMMARY"), UTC)).toBe(
			true,
		);
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
		expect(evaluateCalFilter(doc, makeFilterForProp("X-INT"), UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, makeFilterForProp("X-FLOAT"), UTC)).toBe(
			true,
		);
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
		expect(evaluateCalFilter(doc, makeFilterForProp("X-BOOL"), UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, makeFilterForProp("X-DATE"), UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, makeFilterForProp("X-DT"), UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, makeFilterForProp("URL"), UTC)).toBe(true);
	});

	// CATEGORIES is multi-valued (TEXT_LIST). A text-match must see *every*
	// member, not just the first — `category=PERSONAL` against
	// CATEGORIES:ANNIVERSARY,PERSONAL,SPECIAL OCCASION must match.
	const makeCategoriesFilter = (needle: string): CalFilter => ({
		compFilter: {
			name: "VCALENDAR",
			propFilters: [],
			compFilters: [
				{
					name: "VEVENT",
					propFilters: [
						{
							name: "CATEGORIES",
							paramFilters: [],
							textMatch: {
								value: needle,
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

	const categoriesDoc = makeDoc([
		makeComponent("VEVENT", [
			{
				name: "CATEGORIES",
				parameters: [],
				value: {
					type: "TEXT_LIST",
					value: ["ANNIVERSARY", "PERSONAL", "SPECIAL OCCASION"],
				},
				isKnown: true,
			},
		]),
	]);

	it("TEXT_LIST text-match matches a non-first member", () => {
		expect(
			evaluateCalFilter(categoriesDoc, makeCategoriesFilter("PERSONAL"), UTC),
		).toBe(true);
	});

	it("TEXT_LIST text-match matches the first member", () => {
		expect(
			evaluateCalFilter(
				categoriesDoc,
				makeCategoriesFilter("ANNIVERSARY"),
				UTC,
			),
		).toBe(true);
	});

	it("TEXT_LIST text-match does not match an absent value", () => {
		expect(
			evaluateCalFilter(categoriesDoc, makeCategoriesFilter("FINANCE"), UTC),
		).toBe(false);
	});

	// RFC 4791 §7.5.1: i;octet is a mandatory, case-sensitive collation.
	const makeOctetFilter = (needle: string): CalFilter => ({
		compFilter: {
			name: "VCALENDAR",
			propFilters: [],
			compFilters: [
				{
					name: "VEVENT",
					propFilters: [
						{
							name: "CATEGORIES",
							paramFilters: [],
							textMatch: {
								value: needle,
								collation: "i;octet",
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

	it("i;octet collation matches case-exactly", () => {
		expect(
			evaluateCalFilter(categoriesDoc, makeOctetFilter("PERSONAL"), UTC),
		).toBe(true);
	});

	it("i;octet collation is case-sensitive (lowercase does not match)", () => {
		expect(
			evaluateCalFilter(categoriesDoc, makeOctetFilter("personal"), UTC),
		).toBe(false);
	});
});
