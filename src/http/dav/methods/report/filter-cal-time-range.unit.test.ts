import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Temporal } from "temporal-polyfill";
import { resolutionZone, UTC } from "#src/data/icalendar/resolve-floating.ts";
import type { IrComponent, IrDocument, IrProperty } from "#src/data/ir.ts";
import { type CalFilter, evaluateCalFilter } from "./filter-cal.ts";

// Time-range evaluation of a parsed CALDAV:filter. Filter parsing lives in
// filter-cal-parse.unit.test.ts, the remaining match rules in
// filter-cal.unit.test.ts.

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const textProp = (name: string, text: string): IrProperty => ({
	name,
	parameters: [],
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(false);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(false);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
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
		expect(evaluateCalFilter(doc, filter, UTC)).toBe(true);
	});
});
// ---------------------------------------------------------------------------
// Floating-time resolution — RFC 4791 §7.3
//
// A floating DTSTART names wall-clock time with no instant, so which events a
// time-range filter matches depends on the zone the server resolves it in.
// ---------------------------------------------------------------------------

const floatingProp = (name: string, wall: string): IrProperty => ({
	name,
	parameters: [],
	value: { type: "PLAIN_DATE_TIME", value: Temporal.PlainDateTime.from(wall) },
	isKnown: true,
});

const rangeFilter = (start: string, end: string): CalFilter => ({
	compFilter: {
		name: "VCALENDAR",
		propFilters: [],
		compFilters: [
			{
				name: "VEVENT",
				timeRange: {
					start: Temporal.Instant.from(start),
					end: Temporal.Instant.from(end),
				},
				propFilters: [],
				compFilters: [],
			},
		],
	},
});

describe("evaluateCalFilter — floating time resolution", () => {
	// 09:00-10:00 floating: 09:00Z in UTC, but 07:00-08:00Z in Berlin (CEST)
	const floatingEvent = makeDoc([
		makeComponent("VEVENT", [
			floatingProp("DTSTART", "2026-06-01T09:00"),
			floatingProp("DTEND", "2026-06-01T10:00"),
		]),
	]);

	it("resolves a floating event in the supplied zone", () => {
		const berlin = resolutionZone("Europe/Berlin");
		// 07:00-08:00Z window catches the event in Berlin but not in UTC
		const morning = rangeFilter("2026-06-01T07:00:00Z", "2026-06-01T08:00:00Z");
		expect(evaluateCalFilter(floatingEvent, morning, berlin)).toBe(true);
		expect(evaluateCalFilter(floatingEvent, morning, UTC)).toBe(false);
	});

	it("excludes a floating event that falls outside the range in that zone", () => {
		const berlin = resolutionZone("Europe/Berlin");
		const nineToTen = rangeFilter(
			"2026-06-01T09:00:00Z",
			"2026-06-01T10:00:00Z",
		);
		expect(evaluateCalFilter(floatingEvent, nineToTen, berlin)).toBe(false);
		expect(evaluateCalFilter(floatingEvent, nineToTen, UTC)).toBe(true);
	});

	// An all-day event's day boundaries are local, not UTC midnight
	it("resolves an all-day event's boundaries in the supplied zone", () => {
		const allDay = makeDoc([
			makeComponent("VEVENT", [
				dateProp("DTSTART", "2026-06-02"),
				dateProp("DTEND", "2026-06-03"),
			]),
		]);
		// 22:00Z on Jun 1 is already Jun 2 in Berlin, but still Jun 1 in UTC
		const lateOnTheFirst = rangeFilter(
			"2026-06-01T22:00:00Z",
			"2026-06-01T23:00:00Z",
		);
		expect(
			evaluateCalFilter(
				allDay,
				lateOnTheFirst,
				resolutionZone("Europe/Berlin"),
			),
		).toBe(true);
		expect(evaluateCalFilter(allDay, lateOnTheFirst, UTC)).toBe(false);
	});

	// Before the zone was threaded through, a floating VJOURNAL could never match
	it("matches a floating VJOURNAL rather than dropping it", () => {
		const journal = makeDoc([
			makeComponent("VJOURNAL", [floatingProp("DTSTART", "2026-06-01T09:00")]),
		]);
		const filter: CalFilter = {
			compFilter: {
				name: "VCALENDAR",
				propFilters: [],
				compFilters: [
					{
						name: "VJOURNAL",
						timeRange: {
							start: Temporal.Instant.from("2026-06-01T00:00:00Z"),
							end: Temporal.Instant.from("2026-06-02T00:00:00Z"),
						},
						propFilters: [],
						compFilters: [],
					},
				],
			},
		};
		expect(evaluateCalFilter(journal, filter, UTC)).toBe(true);
	});

	// A floating recurring series shifts with the zone the same way
	it("resolves floating RRULE occurrences in the supplied zone", () => {
		const series = makeDoc([
			makeComponent("VEVENT", [
				textProp("UID", "floating-series@test"),
				floatingProp("DTSTART", "2026-06-01T09:00"),
				floatingProp("DTEND", "2026-06-01T10:00"),
				{
					name: "RRULE",
					parameters: [],
					value: { type: "RECUR", value: "FREQ=DAILY" },
					isKnown: true,
				},
			]),
		]);
		const thirdAtSeven = rangeFilter(
			"2026-06-03T07:00:00Z",
			"2026-06-03T07:30:00Z",
		);
		expect(
			evaluateCalFilter(series, thirdAtSeven, resolutionZone("Europe/Berlin")),
		).toBe(true);
		expect(evaluateCalFilter(series, thirdAtSeven, UTC)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// All-day duration — RFC 5545 §3.6.1 / RFC 4791 §9.9
//
// A DATE-valued DTSTART with no DTEND or DURATION lasts one day. Treated as an
// instant it would be invisible to any window opening at or after its midnight.
// ---------------------------------------------------------------------------

describe("evaluateCalFilter — all-day event without DTEND", () => {
	const bareAllDay = makeDoc([
		makeComponent("VEVENT", [dateProp("DTSTART", "2026-06-01")]),
	]);

	it("matches a query for its own day", () => {
		expect(
			evaluateCalFilter(
				bareAllDay,
				rangeFilter("2026-06-01T00:00:00Z", "2026-06-02T00:00:00Z"),
				UTC,
			),
		).toBe(true);
	});

	it("matches a query for an afternoon of that day", () => {
		expect(
			evaluateCalFilter(
				bareAllDay,
				rangeFilter("2026-06-01T12:00:00Z", "2026-06-01T18:00:00Z"),
				UTC,
			),
		).toBe(true);
	});

	it("matches a month window that opens on its own midnight", () => {
		expect(
			evaluateCalFilter(
				bareAllDay,
				rangeFilter("2026-06-01T00:00:00Z", "2026-07-01T00:00:00Z"),
				UTC,
			),
		).toBe(true);
	});

	it("does not match the day before or the day after", () => {
		expect(
			evaluateCalFilter(
				bareAllDay,
				rangeFilter("2026-05-31T00:00:00Z", "2026-06-01T00:00:00Z"),
				UTC,
			),
		).toBe(false);
		expect(
			evaluateCalFilter(
				bareAllDay,
				rangeFilter("2026-06-02T00:00:00Z", "2026-06-03T00:00:00Z"),
				UTC,
			),
		).toBe(false);
	});

	// The day runs midnight to midnight in the resolution zone, not in UTC
	it("spans its own day in the resolution zone", () => {
		const berlin = resolutionZone("Europe/Berlin");
		// 22:00Z on May 31 is already June 1 in Berlin
		expect(
			evaluateCalFilter(
				bareAllDay,
				rangeFilter("2026-05-31T22:30:00Z", "2026-05-31T23:00:00Z"),
				berlin,
			),
		).toBe(true);
		// ...and 22:30Z on June 1 is already June 2 there, so it is over
		expect(
			evaluateCalFilter(
				bareAllDay,
				rangeFilter("2026-06-01T22:30:00Z", "2026-06-01T23:00:00Z"),
				berlin,
			),
		).toBe(false);
	});

	// An explicit DTEND still wins, and a timed event keeps zero duration
	it("leaves an explicit DTEND and timed events alone", () => {
		const withEnd = makeDoc([
			makeComponent("VEVENT", [
				dateProp("DTSTART", "2026-06-01"),
				dateProp("DTEND", "2026-06-02"),
			]),
		]);
		expect(
			evaluateCalFilter(
				withEnd,
				rangeFilter("2026-06-02T00:00:00Z", "2026-06-03T00:00:00Z"),
				UTC,
			),
		).toBe(false);
		const timed = makeDoc([
			makeComponent("VEVENT", [floatingProp("DTSTART", "2026-06-01T09:00")]),
		]);
		expect(
			evaluateCalFilter(
				timed,
				rangeFilter("2026-06-01T08:00:00Z", "2026-06-01T08:30:00Z"),
				UTC,
			),
		).toBe(false);
	});
});
