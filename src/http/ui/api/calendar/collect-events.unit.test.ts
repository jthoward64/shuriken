import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import {
	type CalendarEventView,
	toFullCalendarEvent,
} from "./collect-events.ts";

// ---------------------------------------------------------------------------
// toFullCalendarEvent — the fix for "recurring events don't show in the past":
// the FullCalendar payload must carry the real master DTSTART (so rrule.js does
// not default it to "now") and preserve every RRULE part; recurring events use
// `duration`, not `end`.
// ---------------------------------------------------------------------------

const base: CalendarEventView = {
	id: "evt-1",
	title: "Standup",
	allDay: false,
	start: "2026-06-01T09:00",
	end: "2026-06-01T09:30",
	rruleRaw: null,
	description: "",
	location: "",
	categoriesCsv: "",
};

describe("toFullCalendarEvent", () => {
	it("keeps plain start/end for a non-recurring event", () => {
		const fc = toFullCalendarEvent(base);
		expect(fc.start).toBe("2026-06-01T09:00");
		expect(fc.end).toBe("2026-06-01T09:30");
		expect(fc.rrule).toBeUndefined();
		expect(fc.duration).toBeUndefined();
	});

	it("embeds the real DTSTART and preserves INTERVAL/BYDAY for a timed series", () => {
		const fc = toFullCalendarEvent({
			...base,
			rruleRaw: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE",
		});
		// Real master date embedded — not defaulted to "now".
		expect(fc.rrule).toBe(
			"DTSTART:20260601T090000\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE",
		);
		// Recurring events use duration, not a top-level start/end.
		expect(fc.start).toBeUndefined();
		expect(fc.end).toBeUndefined();
		expect(fc.duration).toBe("PT30M");
	});

	it("uses VALUE=DATE DTSTART and a day duration for an all-day series", () => {
		const fc = toFullCalendarEvent({
			...base,
			allDay: true,
			start: "2026-06-01",
			end: "2026-06-02",
			rruleRaw: "FREQ=WEEKLY",
		});
		expect(fc.rrule).toBe("DTSTART;VALUE=DATE:20260601\nRRULE:FREQ=WEEKLY");
		expect(fc.allDay).toBe(true);
		expect(fc.duration).toBe("P1D");
	});

	it("omits duration when the series has no DTEND", () => {
		const fc = toFullCalendarEvent({
			...base,
			end: null,
			rruleRaw: "FREQ=DAILY",
		});
		expect(fc.rrule).toBe("DTSTART:20260601T090000\nRRULE:FREQ=DAILY");
		expect(fc.duration).toBeUndefined();
	});
});
