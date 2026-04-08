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

	it("returns 403 when unauthenticated", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/should-fail/", {
					expect: { status: 403 },
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
});
