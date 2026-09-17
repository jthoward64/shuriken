import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Temporal } from "temporal-polyfill";
import { monthName } from "./date-picker.ts";

// Regression cover for the calendar-heading formatter. Calling
// Temporal.PlainYearMonth.prototype.toLocaleString directly throws
// "Mismatched calendars" whenever the locale resolves to a calendar other than
// the object's own (iso8601 here, gregory for most locales). That threw inside
// the picker's render, which aborted control initialization for the whole page.

describe("monthName", () => {
	it("formats a year-month without throwing on a calendar mismatch", () => {
		const ym = Temporal.PlainYearMonth.from("2026-09");
		expect(monthName(ym)).toContain("2026");
	});

	it("does not throw for any month of the year", () => {
		for (let month = 1; month <= 12; month++) {
			const ym = Temporal.PlainYearMonth.from({ year: 2026, month });
			expect(() => monthName(ym)).not.toThrow();
		}
	});

	it("is the trap it guards against", () => {
		// If this ever stops throwing, the workaround in monthName can be dropped
		const ym = Temporal.PlainYearMonth.from("2026-09");
		const localeCalendar = new Intl.DateTimeFormat(undefined).resolvedOptions()
			.calendar;
		if (localeCalendar !== ym.calendarId) {
			expect(() =>
				ym.toLocaleString(undefined, { month: "long", year: "numeric" }),
			).toThrow();
		}
	});
});
