// ---------------------------------------------------------------------------
// Unit tests for hasOccurrenceInRange
// ---------------------------------------------------------------------------

import { describe, expect, it } from "bun:test";
import { Temporal } from "temporal-polyfill";
import type { IrComponent } from "#src/data/ir.ts";
import { hasOccurrenceInRange } from "./recurrence-check.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a ZonedDateTime property value in UTC. */
const zdtProp = (name: string, isoStr: string) => ({
	name,
	parameters: [] as [],
	value: {
		type: "DATE_TIME" as const,
		value: Temporal.ZonedDateTime.from(isoStr),
	},
	isKnown: true,
});

/** Build a TEXT/RECUR property value. */
const textProp = (name: string, value: string) => ({
	name,
	parameters: [] as [],
	value: { type: name === "RRULE" ? ("RECUR" as const) : ("TEXT" as const), value },
	isKnown: true,
});

/** Build a DATE property value. */
const dateProp = (name: string, isoDate: string) => ({
	name,
	parameters: [] as [],
	value: {
		type: "DATE" as const,
		value: Temporal.PlainDate.from(isoDate),
	},
	isKnown: true,
});

/** Build a DATE_TIME_LIST property (for EXDATE). */
const zdtListProp = (name: string, isoStrs: Array<string>) => ({
	name,
	parameters: [] as [],
	value: {
		type: "DATE_TIME_LIST" as const,
		value: isoStrs.map((s) => Temporal.ZonedDateTime.from(s)),
	},
	isKnown: true,
});

/** Build a VEVENT component. */
const makeVevent = (
	uid: string,
	dtstart: ReturnType<typeof zdtProp> | ReturnType<typeof dateProp>,
	rrule: string,
	extra: Array<
		ReturnType<typeof zdtProp> |
		ReturnType<typeof dateProp> |
		ReturnType<typeof zdtListProp> |
		ReturnType<typeof textProp>
	> = [],
): IrComponent => ({
	name: "VEVENT",
	properties: [
		textProp("UID", uid),
		dtstart,
		textProp("RRULE", rrule),
		...extra,
	],
	components: [],
});

/** Wrap a VEVENT in a VCALENDAR root. */
const vcal = (...vevents: Array<IrComponent>): IrComponent => ({
	name: "VCALENDAR",
	properties: [],
	components: vevents,
});

/** UTC instant from an ISO string. */
const inst = (iso: string) => Temporal.Instant.from(iso);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("hasOccurrenceInRange", () => {
	describe("FREQ=DAILY", () => {
		it("returns true when an occurrence falls in range", () => {
			const vevent = makeVevent(
				"daily@test",
				zdtProp("DTSTART", "2026-01-01T09:00:00Z[UTC]"),
				"FREQ=DAILY",
			);
			const root = vcal(vevent);
			expect(
				hasOccurrenceInRange(
					root,
					vevent,
					inst("2026-01-05T00:00:00Z"),
					inst("2026-01-06T00:00:00Z"),
				),
			).toBe(true);
		});

		it("returns false when all occurrences are before range", () => {
			const vevent = makeVevent(
				"daily-count@test",
				zdtProp("DTSTART", "2026-01-01T09:00:00Z[UTC]"),
				"FREQ=DAILY;COUNT=3",
			);
			const root = vcal(vevent);
			// COUNT=3 → occurrences on Jan 1, 2, 3 only
			expect(
				hasOccurrenceInRange(
					root,
					vevent,
					inst("2026-01-05T00:00:00Z"),
					inst("2026-01-06T00:00:00Z"),
				),
			).toBe(false);
		});
	});

	describe("FREQ=WEEKLY", () => {
		it("returns true when a BYDAY occurrence hits the range", () => {
			// Starts Monday Jan 5 2026; BYDAY=MO,WE,FR
			const vevent = makeVevent(
				"weekly-mwf@test",
				zdtProp("DTSTART", "2026-01-05T10:00:00Z[UTC]"),
				"FREQ=WEEKLY;BYDAY=MO,WE,FR",
			);
			const root = vcal(vevent);
			// Query covers Wednesday Jan 7 2026
			expect(
				hasOccurrenceInRange(
					root,
					vevent,
					inst("2026-01-07T00:00:00Z"),
					inst("2026-01-08T00:00:00Z"),
				),
			).toBe(true);
		});

		it("returns false when no BYDAY occurrence hits the range", () => {
			const vevent = makeVevent(
				"weekly-mwf-sun@test",
				zdtProp("DTSTART", "2026-01-05T10:00:00Z[UTC]"),
				"FREQ=WEEKLY;BYDAY=MO,WE,FR",
			);
			const root = vcal(vevent);
			// Query covers only Sunday Jan 11 2026
			expect(
				hasOccurrenceInRange(
					root,
					vevent,
					inst("2026-01-11T00:00:00Z"),
					inst("2026-01-12T00:00:00Z"),
				),
			).toBe(false);
		});
	});

	describe("FREQ=MONTHLY", () => {
		it("returns true for BYDAY=2MO when range spans 2nd Monday", () => {
			const vevent = makeVevent(
				"monthly-2mo@test",
				zdtProp("DTSTART", "2026-01-12T10:00:00Z[UTC]"),
				"FREQ=MONTHLY;BYDAY=2MO",
			);
			const root = vcal(vevent);
			// 2nd Monday of Feb 2026 is Feb 9
			expect(
				hasOccurrenceInRange(
					root,
					vevent,
					inst("2026-02-09T00:00:00Z"),
					inst("2026-02-10T00:00:00Z"),
				),
			).toBe(true);
		});

		it("returns true for BYDAY=-1FR (last Friday)", () => {
			const vevent = makeVevent(
				"monthly-last-fri@test",
				zdtProp("DTSTART", "2026-01-30T10:00:00Z[UTC]"),
				"FREQ=MONTHLY;BYDAY=-1FR",
			);
			const root = vcal(vevent);
			// Last Friday of Feb 2026 is Feb 27
			expect(
				hasOccurrenceInRange(
					root,
					vevent,
					inst("2026-02-27T00:00:00Z"),
					inst("2026-02-28T00:00:00Z"),
				),
			).toBe(true);
		});
	});

	describe("FREQ=YEARLY", () => {
		it("returns true when query is in the right month", () => {
			const vevent = makeVevent(
				"yearly-jun@test",
				zdtProp("DTSTART", "2000-06-12T10:00:00Z[UTC]"),
				"FREQ=YEARLY;BYMONTH=6;BYDAY=2MO",
			);
			const root = vcal(vevent);
			// 2nd Monday of June 2026 is June 8
			expect(
				hasOccurrenceInRange(
					root,
					vevent,
					inst("2026-06-08T00:00:00Z"),
					inst("2026-06-09T00:00:00Z"),
				),
			).toBe(true);
		});

		it("returns false when query is in the wrong month", () => {
			const vevent = makeVevent(
				"yearly-jun-mar@test",
				zdtProp("DTSTART", "2000-06-12T10:00:00Z[UTC]"),
				"FREQ=YEARLY;BYMONTH=6;BYDAY=2MO",
			);
			const root = vcal(vevent);
			expect(
				hasOccurrenceInRange(
					root,
					vevent,
					inst("2026-03-01T00:00:00Z"),
					inst("2026-04-01T00:00:00Z"),
				),
			).toBe(false);
		});
	});

	describe("UNTIL termination", () => {
		it("returns false when UNTIL is before query range", () => {
			const vevent = makeVevent(
				"until@test",
				zdtProp("DTSTART", "2026-01-01T09:00:00Z[UTC]"),
				"FREQ=DAILY;UNTIL=20260103T000000Z",
			);
			const root = vcal(vevent);
			expect(
				hasOccurrenceInRange(
					root,
					vevent,
					inst("2026-01-10T00:00:00Z"),
					inst("2026-01-11T00:00:00Z"),
				),
			).toBe(false);
		});

		it("returns true when an occurrence falls before UNTIL within range", () => {
			const vevent = makeVevent(
				"until-in@test",
				zdtProp("DTSTART", "2026-01-01T09:00:00Z[UTC]"),
				"FREQ=DAILY;UNTIL=20260110T000000Z",
			);
			const root = vcal(vevent);
			expect(
				hasOccurrenceInRange(
					root,
					vevent,
					inst("2026-01-05T00:00:00Z"),
					inst("2026-01-06T00:00:00Z"),
				),
			).toBe(true);
		});
	});

	describe("EXDATE", () => {
		it("returns false when EXDATE removes the only in-range occurrence", () => {
			const vevent: IrComponent = {
				name: "VEVENT",
				properties: [
					textProp("UID", "exdate@test"),
					zdtProp("DTSTART", "2026-01-05T09:00:00Z[UTC]"),
					textProp("RRULE", "FREQ=WEEKLY"),
					zdtListProp("EXDATE", ["2026-01-12T09:00:00Z[UTC]"]),
				],
				components: [],
			};
			const root = vcal(vevent);
			expect(
				hasOccurrenceInRange(
					root,
					vevent,
					inst("2026-01-12T00:00:00Z"),
					inst("2026-01-13T00:00:00Z"),
				),
			).toBe(false);
		});

		it("returns true when EXDATE removes some occurrences but ≥1 remain", () => {
			const vevent: IrComponent = {
				name: "VEVENT",
				properties: [
					textProp("UID", "exdate-partial@test"),
					zdtProp("DTSTART", "2026-01-05T09:00:00Z[UTC]"),
					textProp("RRULE", "FREQ=DAILY"),
					zdtListProp("EXDATE", ["2026-01-06T09:00:00Z[UTC]"]),
				],
				components: [],
			};
			const root = vcal(vevent);
			// Jan 5 (DTSTART) and Jan 7 are in range; Jan 6 is excluded
			expect(
				hasOccurrenceInRange(
					root,
					vevent,
					inst("2026-01-05T00:00:00Z"),
					inst("2026-01-08T00:00:00Z"),
				),
			).toBe(true);
		});
	});

	describe("RECURRENCE-ID overrides", () => {
		it("returns false when override removes the only in-range occurrence", () => {
			const master: IrComponent = {
				name: "VEVENT",
				properties: [
					textProp("UID", "recid@test"),
					zdtProp("DTSTART", "2026-01-05T09:00:00Z[UTC]"),
					textProp("RRULE", "FREQ=WEEKLY"),
				],
				components: [],
			};
			// Override replaces Jan 12 occurrence (moves it to Jan 14)
			const override: IrComponent = {
				name: "VEVENT",
				properties: [
					textProp("UID", "recid@test"),
					zdtProp("DTSTART", "2026-01-14T09:00:00Z[UTC]"),
					zdtProp("RECURRENCE-ID", "2026-01-12T09:00:00Z[UTC]"),
				],
				components: [],
			};
			const root = vcal(master, override);
			// Query covers only Jan 12 — the master's occurrence was replaced
			expect(
				hasOccurrenceInRange(
					root,
					master,
					inst("2026-01-12T00:00:00Z"),
					inst("2026-01-13T00:00:00Z"),
				),
			).toBe(false);
		});

		it("returns true when override is for a different occurrence", () => {
			const master: IrComponent = {
				name: "VEVENT",
				properties: [
					textProp("UID", "recid-other@test"),
					zdtProp("DTSTART", "2026-01-05T09:00:00Z[UTC]"),
					textProp("RRULE", "FREQ=WEEKLY"),
				],
				components: [],
			};
			// Override replaces Jan 12 but we're querying Jan 19
			const override: IrComponent = {
				name: "VEVENT",
				properties: [
					textProp("UID", "recid-other@test"),
					zdtProp("DTSTART", "2026-01-14T09:00:00Z[UTC]"),
					zdtProp("RECURRENCE-ID", "2026-01-12T09:00:00Z[UTC]"),
				],
				components: [],
			};
			const root = vcal(master, override);
			expect(
				hasOccurrenceInRange(
					root,
					master,
					inst("2026-01-19T00:00:00Z"),
					inst("2026-01-20T00:00:00Z"),
				),
			).toBe(true);
		});
	});

	describe("RDATE", () => {
		it("returns true when RDATE adds an extra in-range date", () => {
			// UNTIL expires in Jan 2026, so the RRULE produces no occurrence in June.
			// The RDATE on Jun 15 is the only thing that brings us into range.
			const vevent: IrComponent = {
				name: "VEVENT",
				properties: [
					textProp("UID", "rdate@test"),
					zdtProp("DTSTART", "2026-01-01T09:00:00Z[UTC]"),
					textProp("RRULE", "FREQ=DAILY;UNTIL=20260110T000000Z"),
					zdtListProp("RDATE", ["2026-06-15T09:00:00Z[UTC]"]),
				],
				components: [],
			};
			const root = vcal(vevent);
			expect(
				hasOccurrenceInRange(
					root,
					vevent,
					inst("2026-06-15T00:00:00Z"),
					inst("2026-06-16T00:00:00Z"),
				),
			).toBe(true);
		});
	});

	describe("all-day events (DATE dtstart)", () => {
		it("returns true when a yearly all-day occurrence matches", () => {
			const vevent: IrComponent = {
				name: "VEVENT",
				properties: [
					textProp("UID", "allday@test"),
					dateProp("DTSTART", "2000-06-12"),
					textProp("RRULE", "FREQ=YEARLY"),
				],
				components: [],
			};
			const root = vcal(vevent);
			// June 12 2026 falls in range
			expect(
				hasOccurrenceInRange(
					root,
					vevent,
					inst("2026-06-12T00:00:00Z"),
					inst("2026-06-13T00:00:00Z"),
				),
			).toBe(true);
		});

		it("returns false when the all-day occurrence is outside range", () => {
			const vevent: IrComponent = {
				name: "VEVENT",
				properties: [
					textProp("UID", "allday-miss@test"),
					dateProp("DTSTART", "2000-06-12"),
					textProp("RRULE", "FREQ=YEARLY"),
				],
				components: [],
			};
			const root = vcal(vevent);
			expect(
				hasOccurrenceInRange(
					root,
					vevent,
					inst("2026-06-13T00:00:00Z"),
					inst("2026-06-14T00:00:00Z"),
				),
			).toBe(false);
		});
	});
});
