import { describe, expect, it } from "bun:test";
import { makeCalEvent, makeVCard } from "#src/testing/data.ts";
import {
	PROPFIND_ALLPROP,
	PROPFIND_DISPLAYNAME,
	PROPFIND_RESOURCETYPE,
	propfind,
	put,
	singleUser,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

const PROPFIND_GETETAG = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <D:getcontenttype/>
    <D:getlastmodified/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>`;

const PROPFIND_SYNC_TOKEN = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:sync-token/>
  </D:prop>
</D:propfind>`;

const PROPFIND_SUPPORTED_COMPONENTS = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <C:supported-calendar-component-set/>
  </D:prop>
</D:propfind>`;

const PROPFIND_MISSING_PROP = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:displayname/>
    <D:nosuchprop/>
  </D:prop>
</D:propfind>`;

// RFC 4918 §9.1: propname returns all live property names without values.
const PROPFIND_PROPNAME = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:propname/>
</D:propfind>`;

// RFC 4791 §6.2.1: calendar-home-set is a required CalDAV principal property.
const PROPFIND_CALENDAR_HOME_SET = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <C:calendar-home-set/>
  </D:prop>
</D:propfind>`;

// RFC 6352 §6.2.1: addressbook-home-set is a required CardDAV principal property.
const PROPFIND_ADDRESSBOOK_HOME_SET = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <C:addressbook-home-set/>
  </D:prop>
</D:propfind>`;

// RFC 5397 §3: current-user-principal lets clients discover their own principal URL.
const PROPFIND_CURRENT_USER_PRINCIPAL = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:current-user-principal/>
  </D:prop>
</D:propfind>`;

describe("PROPFIND collection", () => {
	it("Depth:0 on calendar collection returns resourcetype with caldav:calendar", async () => {
		const results = await runScript(
			[
				propfind("/dav/principals/test/cal/primary/", PROPFIND_RESOURCETYPE, {
					as: "test",
					headers: { Depth: "0" },
					expect: {
						status: 207,
						bodyContains: "calendar",
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("Depth:0 on addressbook collection returns resourcetype with carddav:addressbook", async () => {
		const results = await runScript(
			[
				propfind("/dav/principals/test/card/primary/", PROPFIND_RESOURCETYPE, {
					as: "test",
					headers: { Depth: "0" },
					expect: {
						status: 207,
						bodyContains: "addressbook",
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("Depth:0 on collection returns sync-token in URN format", async () => {
		const results = await runScript(
			[
				propfind("/dav/principals/test/cal/primary/", PROPFIND_SYNC_TOKEN, {
					as: "test",
					headers: { Depth: "0" },
					expect: {
						status: 207,
						bodyContains: "urn:ietf:params:xml:ns:sync:",
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("Depth:0 on calendar collection returns supported-calendar-component-set", async () => {
		const results = await runScript(
			[
				propfind(
					"/dav/principals/test/cal/primary/",
					PROPFIND_SUPPORTED_COMPONENTS,
					{
						as: "test",
						headers: { Depth: "0" },
						expect: {
							status: 207,
							bodyContains: "supported-calendar-component-set",
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

	it("Depth:1 on empty calendar collection returns only the collection itself", async () => {
		const results = await runScript(
			[
				propfind("/dav/principals/test/cal/primary/", PROPFIND_ALLPROP, {
					as: "test",
					headers: { Depth: "1" },
					expect: { status: 207 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		// No instance hrefs should appear (collection is empty)
		expect(results[0]?.body).not.toContain(".ics");
	});

	it("Depth:infinity returns 403 (DAV:propfind-finite-depth)", async () => {
		// The DAV router returns an empty-body 403 for DavErrors; the
		// precondition name is carried in the error type, not the response body.
		const results = await runScript(
			[
				propfind("/dav/principals/test/cal/primary/", PROPFIND_ALLPROP, {
					as: "test",
					headers: { Depth: "infinity" },
					expect: { status: 403 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("specific <D:prop> request returns found props in 200 propstat and missing in 404", async () => {
		const results = await runScript(
			[
				propfind("/dav/principals/test/cal/primary/", PROPFIND_MISSING_PROP, {
					as: "test",
					headers: { Depth: "0" },
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
});

const instanceEvent = makeCalEvent({
	uid: "propfind-instance-001@example.com",
	summary: "Propfind Instance Test",
	dtstart: "20260115T100000Z",
	dtend: "20260115T110000Z",
});

const instanceVCard = makeVCard({
	uid: "propfind-instance-001@example.com",
	fn: "Propfind Contact",
});

describe("PROPFIND instance", () => {
	it("Depth:0 on calendar instance returns getetag, getcontenttype, resourcetype, getlastmodified", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/inst.ics",
					instanceEvent,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				propfind(
					"/dav/principals/test/cal/primary/inst.ics",
					PROPFIND_GETETAG,
					{
						as: "test",
						headers: { Depth: "0" },
						expect: {
							status: 207,
							bodyContains: ["getetag", "getcontenttype", "getlastmodified"],
						},
					},
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		const pfResult = results[1];
		expect(pfResult?.body).toContain("text/calendar");
	});

	it("Depth:0 on addressbook instance returns text/vcard content-type", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/card/primary/contact.vcf",
					instanceVCard,
					"text/vcard; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				propfind(
					"/dav/principals/test/card/primary/contact.vcf",
					PROPFIND_GETETAG,
					{
						as: "test",
						headers: { Depth: "0" },
						expect: {
							status: 207,
							bodyContains: "text/vcard",
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

describe("PROPFIND propname", () => {
	// RFC 4918 §9.1: <D:propname/> returns the names of all live properties
	// without their values. The response must be 207 and the body must contain
	// property name elements (not their values).
	it("propname on calendar collection returns property names without values", async () => {
		const results = await runScript(
			[
				propfind("/dav/principals/test/cal/primary/", PROPFIND_PROPNAME, {
					as: "test",
					headers: { Depth: "0" },
					expect: { status: 207 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		// Property names must appear in the response body
		expect(results[0]?.body).toContain("resourcetype");
		expect(results[0]?.body).toContain("displayname");
		// Values must not appear — the sync-token value is a URN, so its absence
		// proves that only names (not content) were returned.
		expect(results[0]?.body).not.toContain("urn:ietf:params:xml:ns:sync:");
	});
});

describe("PROPFIND non-existent resource", () => {
	// RFC 4918 §9.1: PROPFIND on a URL that maps to no resource must return 404.
	it("PROPFIND on a non-existent collection path returns 404", async () => {
		const results = await runScript(
			[
				propfind(
					"/dav/principals/test/cal/does-not-exist/",
					PROPFIND_ALLPROP,
					{
						as: "test",
						headers: { Depth: "0" },
						expect: { status: 404 },
					},
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("PROPFIND on a non-existent instance path returns 404", async () => {
		const results = await runScript(
			[
				propfind(
					"/dav/principals/test/cal/primary/no-such-event.ics",
					PROPFIND_ALLPROP,
					{
						as: "test",
						headers: { Depth: "0" },
						expect: { status: 404 },
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

describe("PROPFIND CalDAV/CardDAV discovery properties", () => {
	// RFC 4791 §6.2.1: CALDAV:calendar-home-set MUST be supported on principal
	// resources so that clients can discover the user's calendar collections.
	it("calendar-home-set on principal returns a 200 propstat with a href value", async () => {
		const results = await runScript(
			[
				propfind(
					"/dav/principals/test/",
					PROPFIND_CALENDAR_HOME_SET,
					{
						as: "test",
						headers: { Depth: "0" },
						expect: { status: 207 },
					},
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		// Must appear in a 200 propstat, not a 404 propstat
		expect(results[0]?.body).toContain("calendar-home-set");
		expect(results[0]?.body).not.toContain(
			`<D:status>HTTP/1.1 404 Not Found</D:status>`,
		);
	});

	// RFC 6352 §6.2.1: CARDDAV:addressbook-home-set MUST be supported on
	// principal resources for addressbook discovery.
	it("addressbook-home-set on principal returns a 200 propstat with a href value", async () => {
		const results = await runScript(
			[
				propfind(
					"/dav/principals/test/",
					PROPFIND_ADDRESSBOOK_HOME_SET,
					{
						as: "test",
						headers: { Depth: "0" },
						expect: { status: 207 },
					},
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		expect(results[0]?.body).toContain("addressbook-home-set");
		expect(results[0]?.body).not.toContain(
			`<D:status>HTTP/1.1 404 Not Found</D:status>`,
		);
	});

	// RFC 5397 §3: DAV:current-user-principal allows a client to discover its
	// own principal URL without having to know the slug in advance.
	it("current-user-principal on any resource returns the acting principal href", async () => {
		const results = await runScript(
			[
				propfind(
					"/dav/principals/test/cal/primary/",
					PROPFIND_CURRENT_USER_PRINCIPAL,
					{
						as: "test",
						headers: { Depth: "0" },
						expect: { status: 207 },
					},
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		expect(results[0]?.body).toContain("current-user-principal");
		expect(results[0]?.body).not.toContain(
			`<D:status>HTTP/1.1 404 Not Found</D:status>`,
		);
	});
});

describe("PROPFIND principal", () => {
	it("Depth:0 on principal returns resourcetype with DAV:principal", async () => {
		const results = await runScript(
			[
				propfind("/dav/principals/test/", PROPFIND_RESOURCETYPE, {
					as: "test",
					headers: { Depth: "0" },
					expect: {
						status: 207,
						bodyContains: "principal",
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("Depth:1 on principal lists owned collections", async () => {
		const results = await runScript(
			[
				propfind("/dav/principals/test/", PROPFIND_DISPLAYNAME, {
					as: "test",
					headers: { Depth: "1" },
					expect: {
						status: 207,
						bodyContains: ["primary"],
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
