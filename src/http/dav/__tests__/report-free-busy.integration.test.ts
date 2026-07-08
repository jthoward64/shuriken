import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { makeCalEvent } from "#src/testing/data.ts";
import {
	mkcol,
	put,
	report,
	singleUser,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

// ---------------------------------------------------------------------------
// CALDAV:free-busy-query REPORT — exercises the cal_index over-approximating
// pre-filter (findOverlappingRange). The critical case: a recurring event whose
// master DTSTART falls *before* the query window must still be returned so its
// in-window occurrences contribute to free-busy.
// ---------------------------------------------------------------------------

const COLLECTION = "/dav/principals/test/cal/fb-cal/";

// Weekly Monday meeting starting Jan 5 2026 (a Monday), 10:00–11:00 UTC.
const weeklyEvent = makeCalEvent({
	uid: "fb-weekly@example.com",
	summary: "Weekly Standup",
	dtstart: "20260105T100000Z",
	dtend: "20260105T110000Z",
	rrule: "FREQ=WEEKLY;BYDAY=MO",
});

// A one-off event entirely outside the query window (March) — must NOT appear.
const marchEvent = makeCalEvent({
	uid: "fb-march@example.com",
	summary: "March One-off",
	dtstart: "20260316T100000Z",
	dtend: "20260316T110000Z",
});

const SETUP = [
	mkcol(COLLECTION, { as: "test", expect: { status: 201 } }),
	put(`${COLLECTION}weekly.ics`, weeklyEvent, "text/calendar; charset=utf-8", {
		as: "test",
		expect: { status: 201 },
	}),
	put(`${COLLECTION}march.ics`, marchEvent, "text/calendar; charset=utf-8", {
		as: "test",
		expect: { status: 201 },
	}),
];

// Query a one-week window in February (Feb 2 2026 is a Monday). The weekly
// series has an occurrence here even though its master is back in January.
const freeBusyFeb = `<?xml version="1.0" encoding="utf-8"?>
<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:time-range start="20260202T000000Z" end="20260209T000000Z"/>
</C:free-busy-query>`;

describe("free-busy-query REPORT", () => {
	it("includes a recurring occurrence whose master precedes the window", async () => {
		const results = await runScript(
			[
				...SETUP,
				report(COLLECTION, freeBusyFeb, {
					as: "test",
					expect: {
						status: 200,
						// The Feb 2 occurrence (10:00–11:00) must be reported busy; the
						// March one-off must be excluded by the window pre-filter.
						bodyContains: ["FREEBUSY", "20260202T100000Z"],
						bodyNotContains: "20260316",
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});
