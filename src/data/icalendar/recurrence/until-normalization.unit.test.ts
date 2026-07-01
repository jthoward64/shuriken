import { Temporal as JSTemporal } from "@js-temporal/polyfill";
import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import { decodeICalendar } from "#src/data/icalendar/codec.ts";
import {
	hasOccurrenceInRange,
	normalizeRruleUntil,
} from "./recurrence-check.ts";

// Regression for the CalDAV time-range 500: real clients (Google/Apple/Exchange)
// emit RRULE UNTIL as a naive local datetime (no trailing `Z`), which
// rrule-temporal rejects with a throw. A single such event previously crashed
// the whole calendar-query REPORT, so a client like iOS synced nothing.

describe("normalizeRruleUntil", () => {
	it("interprets a naive datetime UNTIL as UTC when DTSTART is unknown/floating", () => {
		expect(
			normalizeRruleUntil("FREQ=WEEKLY;UNTIL=20260502T010000;BYDAY=TU"),
		).toBe("FREQ=WEEKLY;UNTIL=20260502T010000Z;BYDAY=TU");
	});
	it("interprets a naive datetime UNTIL in DTSTART's timezone", () => {
		// 01:00 America/New_York on 2026-05-02 is EDT (-4) → 05:00 UTC.
		const dtstart = JSTemporal.ZonedDateTime.from(
			"2022-01-01T09:00:00[America/New_York]",
		);
		expect(
			normalizeRruleUntil(
				"FREQ=WEEKLY;UNTIL=20260502T010000;BYDAY=TU",
				dtstart,
			),
		).toBe("FREQ=WEEKLY;UNTIL=20260502T050000Z;BYDAY=TU");
	});
	it("leaves an already-UTC UNTIL untouched", () => {
		expect(normalizeRruleUntil("FREQ=WEEKLY;UNTIL=20260502T010000Z")).toBe(
			"FREQ=WEEKLY;UNTIL=20260502T010000Z",
		);
	});
	it("leaves a DATE-only UNTIL untouched (rrule-temporal accepts it)", () => {
		expect(normalizeRruleUntil("FREQ=WEEKLY;UNTIL=20260502")).toBe(
			"FREQ=WEEKLY;UNTIL=20260502",
		);
	});
});

describe("hasOccurrenceInRange with a naive (non-UTC) UNTIL", () => {
	const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//test//EN
BEGIN:VEVENT
UID:naive-until@test
DTSTART:20220101T140000Z
DTEND:20220101T150000Z
SUMMARY:Weekly ending mid-2026 with a naive UNTIL
RRULE:FREQ=WEEKLY;UNTIL=20260502T010000;BYDAY=TU,TH
END:VEVENT
END:VCALENDAR`;

	it("does not throw and bounds the series correctly", async () => {
		const doc = await Effect.runPromise(decodeICalendar(ics));
		const root = doc.root;
		const vevent = root.components.find((c) => c.name === "VEVENT");
		if (!vevent) {
			throw new Error("no VEVENT");
		}

		// Range fully after the series ends → no occurrence (correctly bounded,
		// not a conservative "always true" fallback).
		const after = hasOccurrenceInRange(
			root,
			vevent,
			Temporal.Instant.from("2026-06-01T00:00:00Z"),
			Temporal.Instant.from("2026-07-01T00:00:00Z"),
		);
		expect(after).toBe(false);

		// Range during the series → an occurrence exists.
		const during = hasOccurrenceInRange(
			root,
			vevent,
			Temporal.Instant.from("2026-04-01T00:00:00Z"),
			Temporal.Instant.from("2026-05-01T00:00:00Z"),
		);
		expect(during).toBe(true);
	});
});
