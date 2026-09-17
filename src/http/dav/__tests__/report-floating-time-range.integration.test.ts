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
// calendar-query time-range over FLOATING values.
//
// Every other test in this directory writes DTSTART with a trailing `Z`, which
// is the one form the cal_index pre-filter always handled. But build-vevent.ts
// writes every timed event this server creates as floating (RFC 5545 form 1),
// so floating is the common case in practice and was the untested one.
//
// The `maintain_cal_index_on_instance_change` trigger used to map a floating
// DTSTART to NULL. That is harmless for the non-recurring clause, which treats
// NULL as a candidate, but the RRULE bucket narrowing computes week/month/year
// offsets *from* dtstart_utc: with NULL those expressions are NULL, the
// enclosing OR is NULL rather than true, and `WHERE ... AND NULL` returns no
// rows. A floating WEEKLY/MONTHLY/YEARLY series was therefore invisible to any
// bounded time-range query.
//
// No CALDAV:timezone and no calendar-timezone are set here, so RFC 4791
// section 7.3 resolves floating values in UTC and the wall times below are the
// instants they name.
// ---------------------------------------------------------------------------

const COLLECTION = "/dav/principals/test/cal/floating-cal/";

// Floating: no trailing Z, no TZID.
const floatingOneOff = makeCalEvent({
	uid: "floating-oneoff@example.com",
	summary: "Floating One-off",
	dtstart: "20260115T100000",
	dtend: "20260115T110000",
});

// Weekly Monday series from Jan 5 2026 (a Monday), also floating.
const floatingWeekly = makeCalEvent({
	uid: "floating-weekly@example.com",
	summary: "Floating Weekly",
	dtstart: "20260105T100000",
	dtend: "20260105T110000",
	rrule: "FREQ=WEEKLY;BYDAY=MO",
});

const SETUP = [
	mkcol(COLLECTION, { as: "test", expect: { status: 201 } }),
	put(
		`${COLLECTION}oneoff.ics`,
		floatingOneOff,
		"text/calendar; charset=utf-8",
		{ as: "test", expect: { status: 201 } },
	),
	put(
		`${COLLECTION}weekly.ics`,
		floatingWeekly,
		"text/calendar; charset=utf-8",
		{ as: "test", expect: { status: 201 } },
	),
];

const timeRangeQuery = (start: string, end: string) =>
	`<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${start}" end="${end}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

describe("calendar-query time-range over floating values", () => {
	it("matches a floating non-recurring event inside the window", async () => {
		const results = await runScript(
			[
				...SETUP,
				report(
					COLLECTION,
					timeRangeQuery("20260115T000000Z", "20260116T000000Z"),
					{
						as: "test",
						expect: {
							status: 207,
							bodyContains: ["floating-oneoff@example.com"],
						},
					},
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("matches a floating WEEKLY series in a later bounded window", async () => {
		// Feb 2 2026 is a Monday, so the series fires inside this window even
		// though its master DTSTART is back in January. This is the case the
		// NULL dtstart_utc silently dropped.
		const results = await runScript(
			[
				...SETUP,
				report(
					COLLECTION,
					timeRangeQuery("20260202T000000Z", "20260209T000000Z"),
					{
						as: "test",
						expect: {
							status: 207,
							bodyContains: ["floating-weekly@example.com"],
						},
					},
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("excludes a floating event outside the window", async () => {
		// Proves the pre-filter still narrows rather than passing everything
		// through now that floating values carry an indexed instant.
		const results = await runScript(
			[
				...SETUP,
				report(
					COLLECTION,
					timeRangeQuery("20300101T000000Z", "20300201T000000Z"),
					{
						as: "test",
						expect: {
							status: 207,
							bodyNotContains: "floating-oneoff@example.com",
						},
					},
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});
