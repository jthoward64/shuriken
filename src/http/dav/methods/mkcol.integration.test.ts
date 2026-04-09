import { describe, expect, it } from "bun:test";
import { mkcol, singleUser } from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

const MKCALENDAR_WITH_DISPLAY_NAME = `<?xml version="1.0" encoding="utf-8"?>
<C:mkcalendar xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>My Calendar</D:displayname>
      <C:calendar-description>A test calendar</C:calendar-description>
    </D:prop>
  </D:set>
</C:mkcalendar>`;

describe("MKCALENDAR", () => {
	it("creates a new calendar collection and returns 201 with Location", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/my-calendar/", {
					as: "test",
					expect: { status: 201 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
			expect(result.headers.location).toContain("my-calendar");
		}
	});

	it("creates a calendar with extended MKCALENDAR body (displayname + description)", async () => {
		const results = await runScript(
			[
				{
					name: "MKCALENDAR with body",
					method: "MKCALENDAR",
					path: "/dav/principals/test/cal/named-calendar/",
					as: "test",
					headers: { "Content-Type": "application/xml; charset=utf-8" },
					body: MKCALENDAR_WITH_DISPLAY_NAME,
					expect: { status: 201 },
				},
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 401 when unauthenticated", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/should-fail/", {
					expect: { status: 401 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 405 when slug already exists (RFC 4918 §9.3.1 — MKCOL only valid on unmapped URL)", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/dup/", {
					as: "test",
					expect: { status: 201 },
				}),
				mkcol("/dav/principals/test/cal/dup/", {
					as: "test",
					expect: { status: 405 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

describe("MKADDRESSBOOK", () => {
	it("creates a new addressbook collection and returns 201 with Location", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/card/my-book/", {
					as: "test",
					expect: { status: 201 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
			expect(result.headers.location).toContain("my-book");
		}
	});

	// RFC 5689 §5.1 and RFC 6352 §6.3.2: MKADDRESSBOOK may carry a body to set
	// initial properties, analogous to MKCALENDAR with a body.
	// Skipped: Bun's Request constructor normalizes MKADDRESSBOOK to GET (Fetch spec
	// forbids non-standard method names), so this test cannot be exercised through
	// the test harness until Bun fixes the issue.
	it.skip("creates an addressbook with extended body (displayname + description)", async () => {
		const results = await runScript(
			[
				{
					name: "MKADDRESSBOOK with body",
					method: "MKADDRESSBOOK",
					path: "/dav/principals/test/card/named-book/",
					as: "test",
					headers: { "Content-Type": "application/xml; charset=utf-8" },
					body: `<?xml version="1.0" encoding="utf-8"?>
<C:mkcol xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>My Contacts</D:displayname>
      <C:addressbook-description>A test addressbook</C:addressbook-description>
    </D:prop>
  </D:set>
</C:mkcol>`,
					expect: { status: 201 },
				},
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

describe("MKCALENDAR — Location header", () => {
	// RFC 4791 §5.3.1: the server MUST return a Location header pointing to the
	// canonical URL of the newly created calendar collection.
	it("Location header reflects the slug used in the request", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/loc-check/", {
					as: "test",
					expect: { status: 201 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		// The Location must end with the slug that was used in the request
		expect(results[0]?.headers.location).toMatch(/loc-check\/?$/);
	});
});

describe("MKCALENDAR — conflict", () => {
	// RFC 4918 §9.3.1: MKCOL MUST fail with 409 Conflict if any intermediate
	// collection in the request URI path does not exist.
	// In this server the principal namespace (/cal/, /card/) is virtual, so the
	// relevant case is attempting to create a calendar for a principal that does
	// not exist — the server cannot create the resource because the ancestor is
	// unmapped.
	it("MKCALENDAR under a non-existent principal returns 403 or 404", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/ghost/cal/my-calendar/", {
					as: "test",
					// RFC 4918 §9.3.1: the principal is an intermediate collection that
					// does not exist, so the server MUST return 409 Conflict.
					expect: { status: 409 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});
