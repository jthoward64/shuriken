import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import { parseCalFilter } from "./filter-cal.ts";

// Parsing of the CALDAV:filter element. Evaluation of a parsed filter against a
// component lives in filter-cal.unit.test.ts.

// Epoch times for January 15, 2026
const T_JAN15_10 = Temporal.Instant.from(
	"2026-01-15T10:00:00Z",
).epochMilliseconds;
const T_JAN15_11 = Temporal.Instant.from(
	"2026-01-15T11:00:00Z",
).epochMilliseconds;
// ---------------------------------------------------------------------------
// parseCalFilter — invalid inputs
// ---------------------------------------------------------------------------

describe("parseCalFilter — invalid inputs", () => {
	it("fails with CALDAV:valid-filter when tree is null", async () => {
		const result = await Effect.runPromise(
			parseCalFilter(null).pipe(Effect.result),
		);
		expect(result._tag).toBe("Failure");
	});

	it("fails when tree is not an object", async () => {
		const result = await Effect.runPromise(
			parseCalFilter("bad").pipe(Effect.result),
		);
		expect(result._tag).toBe("Failure");
	});

	it("fails when filter element is missing", async () => {
		const result = await Effect.runPromise(
			parseCalFilter({}).pipe(Effect.result),
		);
		expect(result._tag).toBe("Failure");
	});

	it("fails when comp-filter is missing inside filter", async () => {
		const CaldavNs = "urn:ietf:params:xml:ns:caldav";
		const cn = (l: string) => `{${CaldavNs}}${l}`;
		const result = await Effect.runPromise(
			parseCalFilter({ [cn("filter")]: {} }).pipe(Effect.result),
		);
		expect(result._tag).toBe("Failure");
	});

	it("fails when filter element is a string (not object)", async () => {
		const CaldavNs = "urn:ietf:params:xml:ns:caldav";
		const cn = (l: string) => `{${CaldavNs}}${l}`;
		const result = await Effect.runPromise(
			parseCalFilter({ [cn("filter")]: "bad" }).pipe(Effect.result),
		);
		expect(result._tag).toBe("Failure");
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
