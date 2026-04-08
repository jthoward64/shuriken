import { describe, expect, it } from "bun:test";
import { makeCalEvent, makeVCalendar, makeVEvent } from "#src/testing/data.ts";
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
				report(
					"/dav/principals/test/cal/report-cal/",
					querySummaryNotJanuary,
					{
						as: "test",
						expect: {
							status: 207,
							bodyContains: FEB_UID,
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
});
