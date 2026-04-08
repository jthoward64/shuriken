import { describe, expect, it } from "bun:test";
import { makeCalEvent } from "#src/testing/data.ts";
import {
	options,
	put,
	singleUser,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

const EVENT = makeCalEvent({
	uid: "options-test-001@example.com",
	summary: "Options Test Event",
	dtstart: "20260115T100000Z",
	dtend: "20260115T110000Z",
});

// RFC 4918 §5.1, RFC 4791 §5.1, RFC 6352 §6.1.1

describe("OPTIONS", () => {
	it("returns correct DAV capabilities on a principal path", async () => {
		const results = await runScript(
			[
				options("/dav/principals/test/", {
					as: "test",
					expect: {
						status: 200,
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
			expect(result.headers.dav).toContain("calendar-access");
			expect(result.headers.dav).toContain("addressbook");
			expect(result.headers.dav).toContain("extended-mkcol");
		}
	});

	it("returns correct DAV capabilities on a collection path", async () => {
		const results = await runScript(
			[
				options("/dav/principals/test/cal/primary/", {
					as: "test",
					expect: { status: 200 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
			expect(result.headers.dav).toContain("calendar-access");
		}
	});

	it("Allow header contains DAV-specific methods", async () => {
		const results = await runScript(
			[
				options("/dav/principals/test/", {
					as: "test",
					expect: { status: 200 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
			const allow = result.headers.allow ?? "";
			expect(allow).toContain("REPORT");
			expect(allow).toContain("MKCALENDAR");
			expect(allow).toContain("MKADDRESSBOOK");
		}
	});

	it("returns 404 on a new-collection (non-existent) path", async () => {
		const results = await runScript(
			[
				options("/dav/principals/test/cal/does-not-exist/", {
					as: "test",
					expect: { status: 404 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// RFC 4918 §9.1: OPTIONS must succeed on any mapped URL, including instances.
	it("returns 200 with DAV capabilities on an instance path", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/opts-event.ics",
					EVENT,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				options("/dav/principals/test/cal/primary/opts-event.ics", {
					as: "test",
					expect: { status: 200 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		const optResult = results[1];
		expect(optResult?.headers.dav).toContain("calendar-access");
	});

	// RFC 4918 §9.8/§9.9, RFC 3744 §8.1: COPY, MOVE, and ACL must appear in the
	// Allow header so clients know these methods are available.
	it("Allow header includes COPY, MOVE, and ACL", async () => {
		const results = await runScript(
			[
				options("/dav/principals/test/", {
					as: "test",
					expect: { status: 200 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		const allow = results[0]?.headers.allow ?? "";
		expect(allow).toContain("COPY");
		expect(allow).toContain("MOVE");
		expect(allow).toContain("ACL");
	});
});
