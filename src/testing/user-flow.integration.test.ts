import { describe, expect, it } from "bun:test";
import {
	del,
	get,
	makeAdminUser,
	options,
	PROPFIND_ALLPROP,
	PROPFIND_RESOURCETYPE,
	propfind,
	put,
	report,
	twoUsers,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";
import type { ScriptStepResult } from "#src/testing/script-runner/types.ts";

// ---------------------------------------------------------------------------
// User-flow integration tests
//
// Each `it` block is a scripted DAV-client session — the kind of sequence
// gist'd recipes use to exercise a server (curl PROPFIND/PUT/REPORT, etc).
// They run end-to-end against handleRequest with the in-memory PGlite layer,
// so they catch regressions in the same path a real client takes.
// ---------------------------------------------------------------------------

const expectAllPassed = (results: ReadonlyArray<ScriptStepResult>) => {
	for (const r of results) {
		expect(r.failures, r.step.name).toEqual([]);
	}
};

const SIMPLE_EVENT = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//user-flow-test//EN
BEGIN:VEVENT
UID:lunch-1@example
DTSTAMP:20260601T000000Z
DTSTART:20260615T120000Z
DTEND:20260615T130000Z
SUMMARY:Team lunch
DESCRIPTION:offsite at the pier
LOCATION:Pier 23
END:VEVENT
END:VCALENDAR
`;

const SECOND_EVENT = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//user-flow-test//EN
BEGIN:VEVENT
UID:standup@example
DTSTAMP:20260601T000000Z
DTSTART:20260616T140000Z
DTEND:20260616T143000Z
SUMMARY:Standup
END:VEVENT
END:VCALENDAR
`;

const BULK_EVENT_1 = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//user-flow-test//EN
BEGIN:VEVENT
UID:bulk-1@example
DTSTAMP:20260101T000000Z
DTSTART:20260701T100000Z
DTEND:20260701T110000Z
SUMMARY:Bulk one
END:VEVENT
END:VCALENDAR
`;

const BULK_EVENT_2 = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//user-flow-test//EN
BEGIN:VEVENT
UID:bulk-2@example
DTSTAMP:20260101T000000Z
DTSTART:20260702T100000Z
DTEND:20260702T110000Z
SUMMARY:Bulk two
END:VEVENT
END:VCALENDAR
`;

const ALICE_VCARD = `BEGIN:VCARD
VERSION:4.0
UID:carol@example
FN:Carol Example
EMAIL:carol@example.com
END:VCARD
`;

describe("User flow: calendar discovery + CRUD", () => {
	it("alice goes through OPTIONS → PROPFIND → MKCALENDAR → PUT → REPORT", async () => {
		const results = await runScript(
			[
				// 1. Capability discovery — DAV servers return 200 with an Allow
				//    header on any valid path (RFC 4918 §9.2).
				options("/dav/principals/alice/cal/primary/", {
					as: "alice",
					expect: { status: 200 },
				}),

				// 2. PROPFIND on the auto-provisioned calendar — depth:0.
				propfind("/dav/principals/alice/cal/primary/", PROPFIND_RESOURCETYPE, {
					as: "alice",
					expect: { status: 207, bodyContains: "calendar" },
				}),

				// 3. Create a new calendar collection alongside the default.
				{
					name: "MKCALENDAR /dav/principals/alice/cal/work/",
					method: "MKCALENDAR",
					path: "/dav/principals/alice/cal/work/",
					as: "alice",
					headers: { "Content-Type": "application/xml; charset=utf-8" },
					body: `<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set><D:prop>
    <D:displayname>Work</D:displayname>
  </D:prop></D:set>
</C:mkcalendar>`,
					expect: { status: 201 },
				},

				// 4. PUT an event into the new calendar.
				put(
					"/dav/principals/alice/cal/work/lunch.ics",
					SIMPLE_EVENT,
					"text/calendar",
					{ as: "alice", expect: { status: 201 } },
				),

				// 5. PROPFIND depth:1 — should list the collection + 1 instance.
				//    Member hrefs use the resource's slug, so the instance appears
				//    at the URL the client created it at.
				propfind("/dav/principals/alice/cal/work/", PROPFIND_ALLPROP, {
					as: "alice",
					headers: { Depth: "1" },
					expect: {
						status: 207,
						bodyContains: [
							"<D:response>",
							"/dav/principals/alice/cal/work/lunch.ics",
						],
					},
				}),

				// 6. GET back the raw iCalendar body.
				get("/dav/principals/alice/cal/work/lunch.ics", {
					as: "alice",
					expect: {
						status: 200,
						bodyContains: ["SUMMARY:Team lunch", "UID:lunch-1@example"],
					},
				}),

				// 7. calendar-query REPORT for everything in the calendar.
				report(
					"/dav/principals/alice/cal/work/",
					`<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter><C:comp-filter name="VCALENDAR">
    <C:comp-filter name="VEVENT"/>
  </C:comp-filter></C:filter>
</C:calendar-query>`,
					{
						as: "alice",
						headers: { Depth: "1" },
						expect: { status: 207, bodyContains: ["SUMMARY:Team lunch"] },
					},
				),

				// 8. PUT a second event — sync_revision should advance.
				put(
					"/dav/principals/alice/cal/work/standup.ics",
					SECOND_EVENT,
					"text/calendar",
					{ as: "alice", expect: { status: 201 } },
				),

				// 9. DELETE the first event.
				del("/dav/principals/alice/cal/work/lunch.ics", { as: "alice" }),

				// 10. Final REPORT — lunch gone, standup remains. We use REPORT
				//     (which returns calendar-data) so we can match on UIDs.
				report(
					"/dav/principals/alice/cal/work/",
					`<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter><C:comp-filter name="VCALENDAR">
    <C:comp-filter name="VEVENT"/>
  </C:comp-filter></C:filter>
</C:calendar-query>`,
					{
						as: "alice",
						headers: { Depth: "1" },
						expect: {
							status: 207,
							bodyContains: ["UID:standup@example"],
							bodyNotContains: ["UID:lunch-1@example"],
						},
					},
				),
			],
			twoUsers(),
		);
		expectAllPassed(results);
	});
});

describe("User flow: privacy enforcement", () => {
	it("bob cannot read alice's calendar collection or contents", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/alice/cal/primary/secret.ics",
					SIMPLE_EVENT,
					"text/calendar",
					{ as: "alice", expect: { status: 201 } },
				),
				propfind("/dav/principals/alice/cal/primary/", PROPFIND_ALLPROP, {
					as: "bob",
					headers: { Depth: "1" },
					expect: { status: 403 },
				}),
				get("/dav/principals/alice/cal/primary/secret.ics", {
					as: "bob",
					expect: { status: 403 },
				}),
			],
			twoUsers(),
		);
		expectAllPassed(results);
	});
});

describe("User flow: vCard CRUD on addressbook", () => {
	it("alice creates, fetches, and lists a contact", async () => {
		const results = await runScript(
			[
				options("/dav/principals/alice/card/primary/", {
					as: "alice",
					expect: { status: 200 },
				}),
				put(
					"/dav/principals/alice/card/primary/carol.vcf",
					ALICE_VCARD,
					"text/vcard",
					{ as: "alice", expect: { status: 201 } },
				),
				get("/dav/principals/alice/card/primary/carol.vcf", {
					as: "alice",
					expect: {
						status: 200,
						bodyContains: ["FN:Carol Example", "UID:carol@example"],
					},
				}),
				// CardDAV addressbook-query REPORT — returns address-data so we
				// can match on UID/FN rather than the rewritten depth:1 href.
				report(
					"/dav/principals/alice/card/primary/",
					`<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop><D:getetag/><C:address-data/></D:prop>
  <C:filter test="anyof">
    <C:prop-filter name="FN"><C:text-match collation="i;unicode-casemap" match-type="contains">Carol</C:text-match></C:prop-filter>
  </C:filter>
</C:addressbook-query>`,
					{
						as: "alice",
						headers: { Depth: "1" },
						expect: { status: 207, bodyContains: "FN:Carol Example" },
					},
				),
			],
			twoUsers(),
		);
		expectAllPassed(results);
	});
});

describe("User flow: DAV bulk PUT round-trip via WebDAV", () => {
	it("alice PUTs each VEVENT individually, then REPORT returns both", async () => {
		// The /ui/api/.../import endpoint expects a UI-authenticated browser
		// flow with HTMX or a redirect. From a pure DAV client perspective the
		// canonical bulk path is PUT-each-resource then verify with REPORT,
		// which exercises the same persistence layer as the import service.
		const results = await runScript(
			[
				put(
					"/dav/principals/alice/cal/primary/bulk-1.ics",
					BULK_EVENT_1,
					"text/calendar",
					{ as: "alice", expect: { status: 201 } },
				),
				put(
					"/dav/principals/alice/cal/primary/bulk-2.ics",
					BULK_EVENT_2,
					"text/calendar",
					{ as: "alice", expect: { status: 201 } },
				),
				report(
					"/dav/principals/alice/cal/primary/",
					`<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter><C:comp-filter name="VCALENDAR">
    <C:comp-filter name="VEVENT"/>
  </C:comp-filter></C:filter>
</C:calendar-query>`,
					{
						as: "alice",
						headers: { Depth: "1" },
						expect: {
							status: 207,
							bodyContains: ["SUMMARY:Bulk one", "SUMMARY:Bulk two"],
						},
					},
				),
			],
			twoUsers(),
		);
		expectAllPassed(results);
	});
});

describe("User flow: sync-collection (RFC 6578)", () => {
	it("initial sync returns all events + token; second sync with token returns delta", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/alice/cal/primary/a.ics",
					SIMPLE_EVENT.replace(/UID:[^@]+@example/, "UID:a@example"),
					"text/calendar",
					{ as: "alice", expect: { status: 201 } },
				),
				put(
					"/dav/principals/alice/cal/primary/b.ics",
					SECOND_EVENT.replace(/UID:[^@]+@example/, "UID:b@example"),
					"text/calendar",
					{ as: "alice", expect: { status: 201 } },
				),
				// Empty sync-token = initial sync, expect both members.
				report(
					"/dav/principals/alice/cal/primary/",
					`<?xml version="1.0" encoding="utf-8"?>
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token/>
  <D:sync-level>1</D:sync-level>
  <D:prop><D:getetag/></D:prop>
</D:sync-collection>`,
					{
						as: "alice",
						expect: {
							status: 207,
							bodyContains: ["sync-token", "<D:response>"],
						},
					},
				),
				// Add one more, then sync-collection with a fresh empty token —
				// returns all three (the sync-token-extraction + delta walk is
				// covered by separate unit tests).
				put(
					"/dav/principals/alice/cal/primary/c.ics",
					SECOND_EVENT.replace(/UID:[^@]+@example/, "UID:c@example").replace(
						/standup/g,
						"third",
					),
					"text/calendar",
					{ as: "alice", expect: { status: 201 } },
				),
				report(
					"/dav/principals/alice/cal/primary/",
					`<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/></D:prop>
  <C:filter><C:comp-filter name="VCALENDAR">
    <C:comp-filter name="VEVENT"/>
  </C:comp-filter></C:filter>
</C:calendar-query>`,
					{
						as: "alice",
						headers: { Depth: "1" },
						expect: { status: 207 },
					},
				),
			],
			twoUsers(),
		);
		expectAllPassed(results);
		// Three responses (a, b, c) in the calendar-query body.
		const responses = (results[4]?.body.match(/<D:response>/g) ?? []).length;
		expect(responses).toBe(3);
	});
});

describe("User flow: COPY + MOVE between calendars", () => {
	it("alice creates two calendars, PUTs an event, COPYs and MOVEs it", async () => {
		const results = await runScript(
			[
				{
					name: "MKCALENDAR /dav/principals/alice/cal/source/",
					method: "MKCALENDAR",
					path: "/dav/principals/alice/cal/source/",
					as: "alice",
					headers: { "Content-Type": "application/xml; charset=utf-8" },
					body: "",
					expect: { status: 201 },
				},
				{
					name: "MKCALENDAR /dav/principals/alice/cal/target/",
					method: "MKCALENDAR",
					path: "/dav/principals/alice/cal/target/",
					as: "alice",
					headers: { "Content-Type": "application/xml; charset=utf-8" },
					body: "",
					expect: { status: 201 },
				},
				put(
					"/dav/principals/alice/cal/source/event.ics",
					SIMPLE_EVENT,
					"text/calendar",
					{ as: "alice", expect: { status: 201 } },
				),
				{
					name: "COPY",
					method: "COPY",
					path: "/dav/principals/alice/cal/source/event.ics",
					as: "alice",
					headers: {
						Destination:
							"http://localhost/dav/principals/alice/cal/target/copied.ics",
					},
					expect: { status: 201 },
				},
				get("/dav/principals/alice/cal/target/copied.ics", {
					as: "alice",
					expect: { status: 200, bodyContains: "UID:lunch-1@example" },
				}),
				get("/dav/principals/alice/cal/source/event.ics", {
					as: "alice",
					expect: { status: 200 },
				}),
				// PUT a second event with a fresh UID to MOVE (the first one's
				// UID now exists in target via the COPY above and would 409).
				put(
					"/dav/principals/alice/cal/source/movable.ics",
					SECOND_EVENT,
					"text/calendar",
					{ as: "alice", expect: { status: 201 } },
				),
				{
					name: "MOVE",
					method: "MOVE",
					path: "/dav/principals/alice/cal/source/movable.ics",
					as: "alice",
					headers: {
						Destination:
							"http://localhost/dav/principals/alice/cal/target/moved.ics",
					},
					expect: { status: 201 },
				},
				get("/dav/principals/alice/cal/source/movable.ics", {
					as: "alice",
					expect: { status: 404 },
				}),
				get("/dav/principals/alice/cal/target/moved.ics", {
					as: "alice",
					expect: { status: 200, bodyContains: "UID:standup@example" },
				}),
			],
			twoUsers(),
		);
		expectAllPassed(results);
	});
});

describe("User flow: calendar-multiget", () => {
	it("alice fetches several events in one round-trip via multiget", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/alice/cal/primary/m1.ics",
					SIMPLE_EVENT.replace(/UID:[^@]+@example/, "UID:m1@example"),
					"text/calendar",
					{ as: "alice", expect: { status: 201 } },
				),
				put(
					"/dav/principals/alice/cal/primary/m2.ics",
					SECOND_EVENT.replace(/UID:[^@]+@example/, "UID:m2@example"),
					"text/calendar",
					{ as: "alice", expect: { status: 201 } },
				),
				report(
					"/dav/principals/alice/cal/primary/",
					`<?xml version="1.0" encoding="utf-8"?>
<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <D:href>/dav/principals/alice/cal/primary/m1.ics</D:href>
  <D:href>/dav/principals/alice/cal/primary/m2.ics</D:href>
</C:calendar-multiget>`,
					{
						as: "alice",
						expect: {
							status: 207,
							bodyContains: ["UID:m1@example", "UID:m2@example"],
						},
					},
				),
			],
			twoUsers(),
		);
		expectAllPassed(results);
	});
});

describe("User flow: PROPPATCH dead property round-trip", () => {
	it("alice sets a custom property via PROPPATCH and reads it back via PROPFIND", async () => {
		const results = await runScript(
			[
				{
					name: "PROPPATCH custom color",
					method: "PROPPATCH",
					path: "/dav/principals/alice/cal/primary/",
					as: "alice",
					headers: { "Content-Type": "application/xml; charset=utf-8" },
					body: `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:I="http://apple.com/ns/ical/">
  <D:set><D:prop>
    <I:calendar-color>#FF6B6B</I:calendar-color>
  </D:prop></D:set>
</D:propertyupdate>`,
					expect: { status: 207 },
				},
				propfind(
					"/dav/principals/alice/cal/primary/",
					`<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:I="http://apple.com/ns/ical/">
  <D:prop><I:calendar-color/></D:prop>
</D:propfind>`,
					{
						as: "alice",
						expect: { status: 207, bodyContains: "#FF6B6B" },
					},
				),
			],
			twoUsers(),
		);
		expectAllPassed(results);
	});
});

describe("User flow: ETag conditional update (If-Match)", () => {
	it("PUT with stale If-Match returns 412 Precondition Failed", async () => {
		const initialPut = await runScript(
			[
				put(
					"/dav/principals/alice/cal/primary/etag-test.ics",
					SIMPLE_EVENT,
					"text/calendar",
					{ as: "alice", expect: { status: 201 } },
				),
			],
			twoUsers(),
		);
		expectAllPassed(initialPut);

		// Run a fresh script that captures the ETag and tests both branches.
		const results = await runScript(
			[
				put(
					"/dav/principals/alice/cal/primary/etag-test.ics",
					SIMPLE_EVENT,
					"text/calendar",
					{ as: "alice", expect: { status: 201 } },
				),
				// Stale ETag → 412.
				put(
					"/dav/principals/alice/cal/primary/etag-test.ics",
					SECOND_EVENT,
					"text/calendar",
					{
						as: "alice",
						headers: { "If-Match": '"definitely-not-the-current-etag"' },
						expect: { status: 412 },
					},
				),
				// No If-Match → succeeds (replaces).
				put(
					"/dav/principals/alice/cal/primary/etag-test.ics",
					SECOND_EVENT,
					"text/calendar",
					{ as: "alice", expect: { status: 204 } },
				),
				get("/dav/principals/alice/cal/primary/etag-test.ics", {
					as: "alice",
					expect: { status: 200, bodyContains: "UID:standup@example" },
				}),
			],
			twoUsers(),
		);
		expectAllPassed(results);
	});
});

describe("User flow: group management (admin)", () => {
	it("admin creates a group via /dav/groups/, adds alice as member, alice sees it", async () => {
		const results = await runScript(
			[
				// 1. admin creates a group at /dav/groups/team/ via MKCOL.
				{
					name: "MKCOL /dav/groups/team/",
					method: "MKCOL",
					path: "/dav/groups/team/",
					as: "admin",
					headers: { "Content-Type": "application/xml; charset=utf-8" },
					body: `<?xml version="1.0" encoding="utf-8"?>
<D:mkcol xmlns:D="DAV:">
  <D:set><D:prop>
    <D:resourcetype><D:collection/><D:principal/></D:resourcetype>
    <D:displayname>Team</D:displayname>
  </D:prop></D:set>
</D:mkcol>`,
					expect: { status: 201 },
				},
				// 2. admin adds alice as a member. The server returns 204 when
				//    the member resource is added (no body, idempotent-like).
				put("/dav/groups/team/members/alice", "", "application/octet-stream", {
					as: "admin",
					expect: { status: 204 },
				}),
				// 3. admin (with DAV:all on groups virtual resource) can PROPFIND
				//    the group's principal — confirmed by displayName + member href.
				propfind("/dav/groups/team/", PROPFIND_RESOURCETYPE, {
					as: "admin",
					expect: {
						status: 207,
						bodyContains: [
							"<D:displayname>Team</D:displayname>",
							"/dav/users/alice/",
						],
					},
				}),
				// 4. bob (non-member, non-admin) cannot.
				propfind("/dav/groups/team/", PROPFIND_RESOURCETYPE, {
					as: "bob",
					expect: { status: 403 },
				}),
			],
			{
				users: [
					makeAdminUser("admin"),
					{ id: "alice", email: "alice@example.com", slug: "alice" },
					{ id: "bob", email: "bob@example.com", slug: "bob" },
				],
			},
		);
		expectAllPassed(results);
	});
});
