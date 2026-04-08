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

	it("returns 403 when unauthenticated", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/event.ics",
					EVENT,
					"text/calendar; charset=utf-8",
					{ expect: { status: 403 } },
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

	// NOTE: The server does not yet enforce that text/vcard cannot be PUT into
	// a calendar collection (CALDAV:supported-calendar-data precondition from
	// RFC 4791 §5.3.2.1). When this is enforced, add a test expecting 415.
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
