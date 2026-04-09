import { describe, expect, it } from "bun:test";
import { makeCalEvent } from "#src/testing/data.ts";
import {
	PROPFIND_DISPLAYNAME,
	PROPFIND_RESOURCETYPE,
	propfind,
	proppatch,
	put,
	singleUser,
	twoUsers,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

// ---------------------------------------------------------------------------
// PROPPATCH — RFC 4918 §9.2
// ---------------------------------------------------------------------------

const EVENT = makeCalEvent({
	uid: "proppatch-test@example.com",
	summary: "Proppatch Test",
	dtstart: "20260115T100000Z",
	dtend: "20260115T110000Z",
});

/** PROPPATCH body that sets DAV:displayname to the given value. */
const setDisplayname = (name: string) =>
	`<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>${name}</D:displayname>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

/** PROPPATCH body that sets CALDAV:calendar-description. */
const setCalendarDescription = (desc: string) =>
	`<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <C:calendar-description>${desc}</C:calendar-description>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

/** PROPPATCH body that sets CARDDAV:addressbook-description. */
const setAddressbookDescription = (desc: string) =>
	`<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:set>
    <D:prop>
      <C:addressbook-description>${desc}</C:addressbook-description>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

/** PROPPATCH body that attempts to set a protected property. */
const setProtectedProp = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:resourcetype><D:collection/></D:resourcetype>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

/** PROPPATCH body that sets both a protected and an allowed property. */
const setMixed = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>Mixed</D:displayname>
      <D:resourcetype><D:collection/></D:resourcetype>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

/** PROPPATCH body that removes DAV:displayname. */
const removeDisplayname = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:remove>
    <D:prop>
      <D:displayname/>
    </D:prop>
  </D:remove>
</D:propertyupdate>`;

// ---------------------------------------------------------------------------
// Collection — displayname
// ---------------------------------------------------------------------------

describe("PROPPATCH collection — displayname", () => {
	// RFC 4918 §9.2: PROPPATCH on a collection must return 207 on success.
	it("sets DAV:displayname and returns 207", async () => {
		const results = await runScript(
			[
				proppatch(
					"/dav/principals/test/cal/primary/",
					setDisplayname("My Work Calendar"),
					{ as: "test", expect: { status: 207, bodyContains: "200" } },
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// RFC 4918 §9.2.1: the new value must be visible in a subsequent PROPFIND.
	it("updated displayname is visible in PROPFIND", async () => {
		const results = await runScript(
			[
				proppatch(
					"/dav/principals/test/cal/primary/",
					setDisplayname("Visible Name"),
					{ as: "test", expect: { status: 207 } },
				),
				propfind("/dav/principals/test/cal/primary/", PROPFIND_DISPLAYNAME, {
					as: "test",
					headers: { Depth: "0" },
					expect: { status: 207, bodyContains: "Visible Name" },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("removes DAV:displayname with <D:remove> and returns 207", async () => {
		const results = await runScript(
			[
				proppatch(
					"/dav/principals/test/cal/primary/",
					setDisplayname("Temp Name"),
					{ as: "test", expect: { status: 207 } },
				),
				proppatch("/dav/principals/test/cal/primary/", removeDisplayname, {
					as: "test",
					expect: { status: 207, bodyContains: "200" },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// Collection — CalDAV/CardDAV live properties
// ---------------------------------------------------------------------------

describe("PROPPATCH collection — live properties", () => {
	// RFC 4791 §5.2.1: calendar-description is a live property on calendar collections.
	it("sets CALDAV:calendar-description on a calendar collection", async () => {
		const results = await runScript(
			[
				proppatch(
					"/dav/principals/test/cal/primary/",
					setCalendarDescription("My work events"),
					{
						as: "test",
						expect: { status: 207, bodyContains: "200" },
					},
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// RFC 6352 §6.2.1: addressbook-description is a live property on addressbook collections.
	it("sets CARDDAV:addressbook-description on an addressbook collection", async () => {
		const results = await runScript(
			[
				proppatch(
					"/dav/principals/test/card/primary/",
					setAddressbookDescription("My contacts"),
					{
						as: "test",
						expect: { status: 207, bodyContains: "200" },
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

// ---------------------------------------------------------------------------
// Protected properties — must return 403 propstat
// ---------------------------------------------------------------------------

describe("PROPPATCH — protected properties", () => {
	// RFC 4918 §9.2: cannot-modify-protected-property — server must return a 403
	// propstat for any property defined as protected.
	it("returns 403 propstat for DAV:resourcetype (protected)", async () => {
		const results = await runScript(
			[
				proppatch("/dav/principals/test/cal/primary/", setProtectedProp, {
					as: "test",
					expect: { status: 207, bodyContains: "403" },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		// Must also contain the cannot-modify-protected-property precondition or 403 propstat
		expect(results[0]?.body).toContain("403");
		expect(results[0]?.body).not.toContain("200");
	});

	// RFC 4918 §9.2.1: atomicity — if any property fails, all fail with 424.
	it("returns 403 for the failed prop and 424 for the dependent prop (atomicity)", async () => {
		const results = await runScript(
			[
				proppatch("/dav/principals/test/cal/primary/", setMixed, {
					as: "test",
					expect: { status: 207, bodyContains: ["403", "424"] },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// Principal
// ---------------------------------------------------------------------------

describe("PROPPATCH principal", () => {
	it("sets DAV:displayname on a principal and returns 207", async () => {
		const results = await runScript(
			[
				proppatch("/dav/principals/test/", setDisplayname("My Display Name"), {
					as: "test",
					expect: { status: 207, bodyContains: "200" },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// Instance
// ---------------------------------------------------------------------------

describe("PROPPATCH instance", () => {
	// DAV dead properties may be set on instances.
	it("sets a dead property on an instance and returns 207", async () => {
		const deadPropBody = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:X="http://example.com/ns">
  <D:set>
    <D:prop>
      <X:color>blue</X:color>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/event.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				proppatch("/dav/principals/test/cal/primary/event.ics", deadPropBody, {
					as: "test",
					expect: { status: 207, bodyContains: "200" },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 403 propstat for DAV:getetag (protected on instances)", async () => {
		const setEtag = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:getetag>"fake-etag"</D:getetag>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/prot.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				proppatch("/dav/principals/test/cal/primary/prot.ics", setEtag, {
					as: "test",
					expect: { status: 207, bodyContains: "403" },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// Authentication / Authorization
// ---------------------------------------------------------------------------

describe("PROPPATCH — auth", () => {
	it("returns 401 when unauthenticated", async () => {
		const results = await runScript(
			[
				proppatch(
					"/dav/principals/test/cal/primary/",
					setDisplayname("Sneaky"),
					// no `as` → unauthenticated
					{ expect: { status: 401 } },
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 403 when a user PROPPATCHes another user's collection", async () => {
		const results = await runScript(
			[
				proppatch(
					"/dav/principals/bob/cal/primary/",
					setDisplayname("Alice was here"),
					{ as: "alice", expect: { status: 403 } },
				),
			],
			twoUsers(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// Not found
// ---------------------------------------------------------------------------

describe("PROPPATCH — not found", () => {
	it("returns 404 for a non-existent collection slug", async () => {
		const results = await runScript(
			[
				proppatch(
					"/dav/principals/test/cal/no-such-calendar/",
					setDisplayname("Ghost"),
					{ as: "test", expect: { status: 404 } },
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// Resourcetype round-trip
// ---------------------------------------------------------------------------

describe("PROPPATCH collection — resourcetype is not affected", () => {
	// Setting displayname must not alter the resourcetype (collection still has
	// the caldav:calendar marker after a PROPPATCH).
	it("calendar resourcetype is preserved after PROPPATCH", async () => {
		const results = await runScript(
			[
				proppatch(
					"/dav/principals/test/cal/primary/",
					setDisplayname("Updated"),
					{ as: "test", expect: { status: 207 } },
				),
				propfind("/dav/principals/test/cal/primary/", PROPFIND_RESOURCETYPE, {
					as: "test",
					headers: { Depth: "0" },
					expect: { status: 207, bodyContains: "calendar" },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});
