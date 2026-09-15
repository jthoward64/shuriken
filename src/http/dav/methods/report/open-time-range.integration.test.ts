import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { makeVCalendar, makeVEvent } from "#src/testing/data.ts";
import {
	put,
	report,
	singleUser,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

// KDE/Qt clients configured with a "last N months" sync window send
// <C:time-range start="..."/> with no `end`. RFC 4791 §9.9 reads a missing
// `end` as +infinity, so every live recurrence must be returned however far in
// the past its DTSTART sits.

const CAL = "/dav/principals/test/cal/primary";

// Each series starts well before the queried range and recurs past it.
const SERIES = [
	{ slug: "yearly", uid: "yearly@example.com", rrule: "FREQ=YEARLY" },
	{ slug: "monthly", uid: "monthly@example.com", rrule: "FREQ=MONTHLY" },
	{
		slug: "biweekly",
		uid: "biweekly@example.com",
		rrule: "FREQ=WEEKLY;INTERVAL=2",
	},
	{ slug: "daily", uid: "daily@example.com", rrule: "FREQ=DAILY" },
] as const;

const openEndedQuery = (
	start: string,
) => `<?xml version="1.0" encoding="UTF-8"?>
<calendar-query xmlns="urn:ietf:params:xml:ns:caldav"><prop xmlns="DAV:"><getetag xmlns="DAV:"/><resourcetype xmlns="DAV:"/></prop><filter xmlns="urn:ietf:params:xml:ns:caldav"><comp-filter xmlns="urn:ietf:params:xml:ns:caldav" name="VCALENDAR"><comp-filter xmlns="urn:ietf:params:xml:ns:caldav" name="VEVENT"><time-range xmlns="urn:ietf:params:xml:ns:caldav" start="${start}"/></comp-filter></comp-filter></filter></calendar-query>`;

const seed = SERIES.map((s) =>
	put(
		`${CAL}/${s.slug}.ics`,
		makeVCalendar(
			makeVEvent({
				uid: s.uid,
				summary: `${s.slug} series`,
				// Starts in March 2024, long before the queried window.
				dtstart: "20240311T100000Z",
				dtend: "20240311T110000Z",
				rrule: s.rrule,
			}),
		),
		"text/calendar; charset=utf-8",
		{ as: "test", expect: { status: 201 } },
	),
);

describe("calendar-query with an open-ended time-range", () => {
	it("returns recurring series whose DTSTART predates the window", async () => {
		const results = await runScript(
			[
				...seed,
				report(`${CAL}/`, openEndedQuery("20260518T000500Z"), {
					as: "test",
					headers: { Depth: "1" },
					expect: { status: 207 },
				}),
			],
			singleUser(),
		);
		for (const r of results) {
			expect(r.failures, r.step.name).toEqual([]);
		}
		const body = results.at(-1)?.body ?? "";
		for (const s of SERIES) {
			expect(body, `${s.slug} must be returned`).toContain(`${s.slug}.ics`);
		}
	});

	it("is not sensitive to which week the window starts in", async () => {
		// The window slides daily in real clients; a week-bucketed pre-filter made
		// results flap from one day to the next.
		const starts = ["20260518T000500Z", "20260519T000500Z", "20260525T000500Z"];
		const results = await runScript(
			[
				...seed,
				...starts.map((s) =>
					report(`${CAL}/`, openEndedQuery(s), {
						as: "test",
						headers: { Depth: "1" },
						expect: { status: 207 },
					}),
				),
			],
			singleUser(),
		);
		for (const r of results) {
			expect(r.failures, r.step.name).toEqual([]);
		}
		const bodies = results.slice(SERIES.length).map((r) => r.body ?? "");
		for (const body of bodies) {
			for (const s of SERIES) {
				expect(
					body,
					`${s.slug} must be returned for every window start`,
				).toContain(`${s.slug}.ics`);
			}
		}
	});
});
