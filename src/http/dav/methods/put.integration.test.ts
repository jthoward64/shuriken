import { describe, expect, it } from "bun:test";
import { makeCalEvent, makeVCard } from "#src/testing/data.ts";
import { put, singleUser } from "#src/testing/script-runner/fixtures.ts";
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
