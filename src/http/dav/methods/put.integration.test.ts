import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { makeCalEvent, makeVCard } from "#src/testing/data.ts";
import {
	del,
	get,
	PROPFIND_RESOURCETYPE,
	propfind,
	put,
	singleUser,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

const EVENT = makeCalEvent({
	uid: "put-test-001@example.com",
	summary: "Put Test Event",
	dtstart: "20260115T100000Z",
	dtend: "20260115T110000Z",
});

const VCARD = makeVCard({
	uid: "put-test-001@example.com",
	fn: "Put Test Contact",
});

describe("PUT iCalendar — content validation", () => {
	// RFC 4791 §5.3.2.1 (CALDAV:valid-calendar-data): the server must reject
	// syntactically invalid iCalendar data before persisting it.
	it("returns 400 for a completely garbled iCalendar body", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/garbage.ics",
					"this is not icalendar data at all",
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 400 } },
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// The root component must be VCALENDAR; a bare VEVENT at the top level
	// is invalid per RFC 5545 §3.4.
	it("returns 400 when the root component is not VCALENDAR", async () => {
		const bareVevent = [
			"BEGIN:VEVENT",
			"UID:bare-vevent@example.com",
			"DTSTAMP:20260101T000000Z",
			"DTSTART:20260115T100000Z",
			"DTEND:20260115T110000Z",
			"SUMMARY:Bare VEVENT",
			"END:VEVENT",
			"",
		].join("\r\n");
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/bare-vevent.ics",
					bareVevent,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 400 } },
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// RFC 4791 §5.3.2.1 (CALDAV:supported-calendar-data): PUT of text/vcard
	// into a calendar collection must be rejected with 415.
	it("returns 415 when PUT text/vcard into a calendar collection", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/wrong.vcf",
					VCARD,
					"text/vcard; charset=utf-8",
					{ as: "test", expect: { status: 415 } },
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

describe("PUT iCalendar", () => {
	it("creates a new instance and returns 201 with ETag", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/event.ics",
					EVENT,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
			expect(result.headers.etag).toBeTruthy();
		}
	});

	it("returns 415 for wrong Content-Type", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/event.ics",
					"not a calendar",
					"text/plain",
					{ as: "test", expect: { status: 415 } },
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// NOTE: The server does not yet enforce that text/calendar cannot be PUT
	// into an addressbook collection (CARDDAV:supported-address-data precondition
	// from RFC 6352 §5.3.2.1). When this is enforced, add a test expecting 415.

	it("returns 401 when unauthenticated", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/event.ics",
					EVENT,
					"text/calendar; charset=utf-8",
					{ expect: { status: 401 } },
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 412 when If-Match is set on a new resource", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/new-event.ics",
					EVENT,
					"text/calendar; charset=utf-8",
					{
						as: "test",
						headers: { "If-Match": "*" },
						expect: { status: 412 },
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

describe("PUT vCard", () => {
	it("creates a new vCard instance and returns 201 with ETag", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/card/primary/contact.vcf",
					VCARD,
					"text/vcard; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
			expect(result.headers.etag).toBeTruthy();
		}
	});

	// RFC 6352 §5.3.2.1 (CARDDAV:supported-address-data): PUT of text/calendar
	// into an addressbook collection must be rejected with 415.
	it("returns 415 when PUT text/calendar into an addressbook collection", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/card/primary/wrong.ics",
					EVENT,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 415 } },
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

describe("PUT conditional headers on existing resource", () => {
	it("returns 412 when If-None-Match: * is set on existing resource", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/cond.ics",
					EVENT,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				put(
					"/dav/principals/test/cal/primary/cond.ics",
					EVENT,
					"text/calendar; charset=utf-8",
					{
						as: "test",
						headers: { "If-None-Match": "*" },
						expect: { status: 412 },
					},
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 412 when If-Match has wrong ETag", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/match.ics",
					EVENT,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				put(
					"/dav/principals/test/cal/primary/match.ics",
					EVENT,
					"text/calendar; charset=utf-8",
					{
						as: "test",
						headers: { "If-Match": '"wrong-etag"' },
						expect: { status: 412 },
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

// Real clients name calendar/contact objects after the UID, which is almost
// always `local@domain` — so the resource name contains `@`. The instance slug
// charset must accept it, and response hrefs must percent-encode it.
// See documentation/planning/finding-instance-slug-charset.md.
describe("PUT object name with @ (UID-derived resource names)", () => {
	const atName = "20010712T182145Z-123401@example.com.ics";

	it("round-trips a calendar object whose name contains @", async () => {
		const results = await runScript(
			[
				put(
					`/dav/principals/test/cal/primary/${atName}`,
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				get(`/dav/principals/test/cal/primary/${atName}`, {
					as: "test",
					expect: { status: 200 },
				}),
				del(`/dav/principals/test/cal/primary/${atName}`, {
					as: "test",
					expect: { status: 204 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("percent-encodes @ in the depth:0 PROPFIND href", async () => {
		const results = await runScript(
			[
				put(
					`/dav/principals/test/cal/primary/${atName}`,
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				propfind(
					`/dav/principals/test/cal/primary/${atName}`,
					PROPFIND_RESOURCETYPE,
					{ as: "test", headers: { Depth: "0" }, expect: { status: 207 } },
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		// The href must carry the encoded `%40`, never a bare `@`.
		expect(results[1]?.body).toContain(
			"20010712T182145Z-123401%40example.com.ics",
		);
		expect(results[1]?.body).not.toContain("123401@example.com.ics");
	});

	it("rejects an object name with a disallowed character (space)", async () => {
		// The relaxed instance charset still excludes spaces (and `.`/`..`/`/`,
		// which URL normalization handles). A `%20` survives URL parsing and
		// decodes to a space at the edge, so this exercises the validator's
		// rejection path over real HTTP → 403.
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/has%20space.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 403 } },
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// RFC 5545 §3.6: DTSTAMP is REQUIRED. Clients sometimes omit it; the server
// fills a missing DTSTAMP with the store time so it never persists/serves
// invalid iCalendar (a supplied DTSTAMP is preserved). See
// src/data/icalendar/ensure-dtstamp.ts.
describe("PUT fills a missing DTSTAMP", () => {
	const eventNoDtstamp = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Test//Test//EN",
		"BEGIN:VEVENT",
		"UID:no-dtstamp@example.com",
		"DTSTART:20260115T100000Z",
		"DTEND:20260115T110000Z",
		"SUMMARY:No DTSTAMP",
		"END:VEVENT",
		"END:VCALENDAR",
		"",
	].join("\r\n");

	const eventWithDtstamp = [
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//Test//Test//EN",
		"BEGIN:VEVENT",
		"UID:has-dtstamp@example.com",
		"DTSTAMP:20200101T000000Z",
		"DTSTART:20260115T100000Z",
		"DTEND:20260115T110000Z",
		"SUMMARY:Has DTSTAMP",
		"END:VEVENT",
		"END:VCALENDAR",
		"",
	].join("\r\n");

	it("adds DTSTAMP when the client omits it", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/no-dtstamp.ics",
					eventNoDtstamp,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				get("/dav/principals/test/cal/primary/no-dtstamp.ics", {
					as: "test",
					expect: { status: 200, bodyContains: ["DTSTAMP"] },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("preserves a client-supplied DTSTAMP", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/has-dtstamp.ics",
					eventWithDtstamp,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				get("/dav/principals/test/cal/primary/has-dtstamp.ics", {
					as: "test",
					expect: { status: 200, bodyContains: ["DTSTAMP:20200101T000000Z"] },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});
