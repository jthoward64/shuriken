import { describe, expect, it } from "bun:test";
import { makeCalEvent } from "#src/testing/data.ts";
import {
	mkcol,
	put,
	report,
	singleUser,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

// ---------------------------------------------------------------------------
// Sample events
// ---------------------------------------------------------------------------

const JAN_UID = "report-cal-jan@example.com";
const FEB_UID = "report-cal-feb@example.com";

const janEvent = makeCalEvent({
	uid: JAN_UID,
	summary: "January Meeting",
	dtstart: "20260115T100000Z",
	dtend: "20260115T110000Z",
});

const febEvent = makeCalEvent({
	uid: FEB_UID,
	summary: "February Meeting",
	dtstart: "20260215T100000Z",
	dtend: "20260215T110000Z",
});

// ---------------------------------------------------------------------------
// Shared setup steps
// ---------------------------------------------------------------------------

const SETUP = [
	mkcol("/dav/principals/test/cal/report-cal/", {
		as: "test",
		expect: { status: 201 },
	}),
	put(
		"/dav/principals/test/cal/report-cal/jan.ics",
		janEvent,
		"text/calendar; charset=utf-8",
		{ as: "test", expect: { status: 201 } },
	),
	put(
		"/dav/principals/test/cal/report-cal/feb.ics",
		febEvent,
		"text/calendar; charset=utf-8",
		{ as: "test", expect: { status: 201 } },
	),
];

// ---------------------------------------------------------------------------
// VTODO sample (no makeVTodo helper, so built directly)
// ---------------------------------------------------------------------------

const TODO_UID = "report-cal-todo@example.com";

const todoCalendar = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"PRODID:-//Test//Test//EN",
	"BEGIN:VTODO",
	`UID:${TODO_UID}`,
	"DTSTAMP:20260101T000000Z",
	"DTSTART:20260301T100000Z",
	"DUE:20260301T110000Z",
	"SUMMARY:Test Todo",
	"END:VTODO",
	"END:VCALENDAR",
	"",
].join("\r\n");

// ---------------------------------------------------------------------------
// calendar-multiget bodies
// ---------------------------------------------------------------------------

const multigetBoth = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-multiget xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <D:href>/dav/principals/test/cal/report-cal/jan.ics</D:href>
  <D:href>/dav/principals/test/cal/report-cal/feb.ics</D:href>
</C:calendar-multiget>`;

const multigetJanOnly = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-multiget xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <D:href>/dav/principals/test/cal/report-cal/jan.ics</D:href>
</C:calendar-multiget>`;

const multigetWithMissing = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-multiget xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <D:href>/dav/principals/test/cal/report-cal/jan.ics</D:href>
  <D:href>/dav/principals/test/cal/report-cal/does-not-exist.ics</D:href>
</C:calendar-multiget>`;

const multigetSubsetted = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-multiget xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data>
      <C:comp name="VCALENDAR">
        <C:allprop/>
        <C:comp name="VEVENT">
          <C:prop name="SUMMARY"/>
          <C:prop name="UID"/>
        </C:comp>
      </C:comp>
    </C:calendar-data>
  </D:prop>
  <D:href>/dav/principals/test/cal/report-cal/jan.ics</D:href>
</C:calendar-multiget>`;

// ---------------------------------------------------------------------------
// calendar-query bodies
// ---------------------------------------------------------------------------

const queryAllVEvents = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT"/>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

const queryJanTimeRange = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="20260101T000000Z" end="20260201T000000Z"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

const queryNoMatch = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="20300101T000000Z" end="20300201T000000Z"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

const querySummaryContainsJanuary = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:prop-filter name="SUMMARY">
          <C:text-match collation="i;unicode-casemap" match-type="contains">January</C:text-match>
        </C:prop-filter>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

const querySummaryNotJanuary = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:prop-filter name="SUMMARY">
          <C:text-match collation="i;unicode-casemap" match-type="contains" negate-condition="yes">January</C:text-match>
        </C:prop-filter>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

const queryVEventIsNotDefined = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:is-not-defined/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

const queryMissingFilter = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
</C:calendar-query>`;

// Range starting exactly at janEvent DTEND — event should NOT appear (half-open [start,end))
// RFC 4791 §9.9: DTEND must be > range start for condition (a); DTSTART must be >= start for (b)
const queryRangeStartAtJanEnd = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="20260115T110000Z" end="20260116T000000Z"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

// Range starting exactly at janEvent DTSTART — event MUST appear (RFC 4791 §9.9 condition b)
const queryRangeStartAtJanStart = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="20260115T100000Z" end="20260115T110000Z"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

// VTODO comp-filter — returns objects that have a VTODO component
const queryAllVTodos = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VTODO"/>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

// prop-filter is-not-defined on LOCATION (never set) — both events should match
const queryLocationIsNotDefined = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:prop-filter name="LOCATION">
          <C:is-not-defined/>
        </C:prop-filter>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

// prop-filter is-not-defined on SUMMARY (always present) — no events should match
const querySummaryIsNotDefined = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:prop-filter name="SUMMARY">
          <C:is-not-defined/>
        </C:prop-filter>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;

// calendar-multiget with no hrefs — should return 207 with no resource responses
const multigetNoHrefs = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-multiget xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
</C:calendar-multiget>`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("calendar-multiget REPORT", () => {
	it("fetches both events by href and returns calendar-data", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/cal/report-cal/", multigetBoth, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: [JAN_UID, FEB_UID],
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("fetches a single event by href", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/cal/report-cal/", multigetJanOnly, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: JAN_UID,
						bodyNotContains: FEB_UID,
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 404 propstat for non-existent href alongside found item", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/cal/report-cal/", multigetWithMissing, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: ["200", "404"],
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns only requested properties when calendar-data subsetting is used", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/cal/report-cal/", multigetSubsetted, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: ["SUMMARY", "January Meeting"],
						bodyNotContains: "DTSTART",
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

describe("calendar-query REPORT", () => {
	it("VEVENT comp-filter with no time-range returns all events", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/cal/report-cal/", queryAllVEvents, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: [JAN_UID, FEB_UID],
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("time-range filter returns only the matching event", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/cal/report-cal/", queryJanTimeRange, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: JAN_UID,
						bodyNotContains: FEB_UID,
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("time-range that matches no events returns 207 with empty responses", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/cal/report-cal/", queryNoMatch, {
					as: "test",
					expect: {
						status: 207,
						bodyNotContains: [JAN_UID, FEB_UID],
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("text-match contains on SUMMARY returns only matching event", async () => {
		const results = await runScript(
			[
				...SETUP,
				report(
					"/dav/principals/test/cal/report-cal/",
					querySummaryContainsJanuary,
					{
						as: "test",
						expect: {
							status: 207,
							bodyContains: JAN_UID,
							bodyNotContains: FEB_UID,
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

	it("text-match with negate-condition excludes matched event", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/cal/report-cal/", querySummaryNotJanuary, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: FEB_UID,
						bodyNotContains: JAN_UID,
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("is-not-defined VEVENT comp-filter returns no events", async () => {
		const results = await runScript(
			[
				...SETUP,
				report(
					"/dav/principals/test/cal/report-cal/",
					queryVEventIsNotDefined,
					{
						as: "test",
						expect: {
							status: 207,
							bodyNotContains: [JAN_UID, FEB_UID],
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

	it("missing <C:filter> element returns 403 CALDAV:valid-filter", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/cal/report-cal/", queryMissingFilter, {
					as: "test",
					expect: {
						status: 403,
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// RFC 4791 §9.9: time-range is a half-open interval [start, end).
	// An event whose DTEND equals the range start does NOT match because
	// condition (a) requires DTEND > start (strict), and condition (b)
	// requires DTSTART >= start — but janEvent DTSTART (10:00) < range start (11:00).
	it("time-range where event DTEND equals range start returns no match", async () => {
		const results = await runScript(
			[
				...SETUP,
				report(
					"/dav/principals/test/cal/report-cal/",
					queryRangeStartAtJanEnd,
					{
						as: "test",
						expect: {
							status: 207,
							bodyNotContains: [JAN_UID, FEB_UID],
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

	// RFC 4791 §9.9 condition (b): DTSTART >= start AND DTSTART < end.
	// An event whose DTSTART equals the range start matches.
	it("time-range where event DTSTART equals range start returns a match", async () => {
		const results = await runScript(
			[
				...SETUP,
				report(
					"/dav/principals/test/cal/report-cal/",
					queryRangeStartAtJanStart,
					{
						as: "test",
						expect: {
							status: 207,
							bodyContains: JAN_UID,
							bodyNotContains: FEB_UID,
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

	// RFC 4791 §9.7.1: prop-filter with is-not-defined matches components that
	// do NOT have the named property.  LOCATION is absent on both test events,
	// so both should appear in the result.
	it("prop-filter is-not-defined on absent property (LOCATION) returns all events", async () => {
		const results = await runScript(
			[
				...SETUP,
				report(
					"/dav/principals/test/cal/report-cal/",
					queryLocationIsNotDefined,
					{
						as: "test",
						expect: {
							status: 207,
							bodyContains: [JAN_UID, FEB_UID],
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

	// prop-filter is-not-defined on SUMMARY (always present) must exclude all events.
	it("prop-filter is-not-defined on present property (SUMMARY) returns no events", async () => {
		const results = await runScript(
			[
				...SETUP,
				report(
					"/dav/principals/test/cal/report-cal/",
					querySummaryIsNotDefined,
					{
						as: "test",
						expect: {
							status: 207,
							bodyNotContains: [JAN_UID, FEB_UID],
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

describe("calendar-query REPORT — VTODO", () => {
	const setupWithTodo = [
		mkcol("/dav/principals/test/cal/report-cal-todo/", {
			as: "test",
			expect: { status: 201 },
		}),
		put(
			"/dav/principals/test/cal/report-cal-todo/todo.ics",
			todoCalendar,
			"text/calendar; charset=utf-8",
			{ as: "test", expect: { status: 201 } },
		),
		put(
			"/dav/principals/test/cal/report-cal-todo/jan.ics",
			janEvent,
			"text/calendar; charset=utf-8",
			{ as: "test", expect: { status: 201 } },
		),
	];

	// RFC 4791 §9.7.1: a comp-filter on VTODO should match only objects that
	// contain a VTODO component, not VEVENT objects.
	it("VTODO comp-filter returns only VTODO objects", async () => {
		const results = await runScript(
			[
				...setupWithTodo,
				report(
					"/dav/principals/test/cal/report-cal-todo/",
					queryAllVTodos,
					{
						as: "test",
						expect: {
							status: 207,
							bodyContains: TODO_UID,
							bodyNotContains: JAN_UID,
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

describe("calendar-multiget REPORT — edge cases", () => {
	// RFC 4791 §7.9: multiget with no <D:href> elements should return a
	// 207 Multi-Status with no resource responses.
	it("multiget with no hrefs returns 207 with empty response set", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/cal/report-cal/", multigetNoHrefs, {
					as: "test",
					expect: {
						status: 207,
						bodyNotContains: [JAN_UID, FEB_UID],
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
