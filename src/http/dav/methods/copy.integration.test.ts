import { describe, expect, it } from "bun:test";
import { makeCalEvent, makeVCard } from "#src/testing/data.ts";
import {
	copy,
	get,
	mkcol,
	PROPFIND_ALLPROP,
	propfind,
	put,
	singleUser,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const EVENT = makeCalEvent({
	uid: "copy-test-001@example.com",
	summary: "Copy Test Event",
	dtstart: "20260301T090000Z",
	dtend: "20260301T100000Z",
});

const VCARD = makeVCard({
	uid: "copy-test-001@example.com",
	fn: "Copy Test Contact",
});

// Helper: assert all steps passed expectations
const expectAllPass = (
	results: ReadonlyArray<{
		failures: ReadonlyArray<string>;
		step: { name?: string };
	}>,
) => {
	for (const result of results) {
		expect(result.failures, result.step.name).toEqual([]);
	}
};

// ---------------------------------------------------------------------------
// COPY instance
// ---------------------------------------------------------------------------

describe("COPY instance", () => {
	it("copies an iCalendar instance to a new location (201)", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/source.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				copy(
					"/dav/principals/test/cal/primary/source.ics",
					"/dav/principals/test/cal/primary/dest.ics",
					{ as: "test", expect: { status: 201 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("copies a vCard instance to a new location (201)", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/card/primary/source.vcf",
					VCARD,
					"text/vcard",
					{ as: "test", expect: { status: 201 } },
				),
				copy(
					"/dav/principals/test/card/primary/source.vcf",
					"/dav/principals/test/card/primary/dest.vcf",
					{ as: "test", expect: { status: 201 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("source is still accessible after copy", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/original.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				copy(
					"/dav/principals/test/cal/primary/original.ics",
					"/dav/principals/test/cal/primary/clone.ics",
					{ as: "test", expect: { status: 201 } },
				),
				get("/dav/principals/test/cal/primary/original.ics", {
					as: "test",
					expect: { status: 200 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("destination is accessible after copy", async () => {
		const results = await runScript(
			[
				put("/dav/principals/test/cal/primary/ev.ics", EVENT, "text/calendar", {
					as: "test",
					expect: { status: 201 },
				}),
				copy(
					"/dav/principals/test/cal/primary/ev.ics",
					"/dav/principals/test/cal/primary/ev-copy.ics",
					{ as: "test", expect: { status: 201 } },
				),
				get("/dav/principals/test/cal/primary/ev-copy.ics", {
					as: "test",
					expect: {
						status: 200,
						bodyContains: "Copy Test Event",
					},
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("copy produces an independent ETag from the source", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/src-etag.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				copy(
					"/dav/principals/test/cal/primary/src-etag.ics",
					"/dav/principals/test/cal/primary/dst-etag.ics",
					{ as: "test", expect: { status: 201 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
		// The COPY response itself contains the new ETag
		const copyResult = results[1];
		expect(copyResult?.headers.etag).toBeTruthy();
	});

	it("Overwrite:T replaces existing destination (204)", async () => {
		const results = await runScript(
			[
				put("/dav/principals/test/cal/primary/a.ics", EVENT, "text/calendar", {
					as: "test",
					expect: { status: 201 },
				}),
				put(
					"/dav/principals/test/cal/primary/b.ics",
					makeCalEvent({
						uid: "copy-overwrite-dest@example.com",
						summary: "Old Destination",
						dtstart: "20260302T090000Z",
						dtend: "20260302T100000Z",
					}),
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				copy(
					"/dav/principals/test/cal/primary/a.ics",
					"/dav/principals/test/cal/primary/b.ics",
					{ as: "test", overwrite: "T", expect: { status: 204 } },
				),
				// Verify destination now has source content
				get("/dav/principals/test/cal/primary/b.ics", {
					as: "test",
					expect: { status: 200, bodyContains: "Copy Test Event" },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("Overwrite:F returns 412 when destination exists", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/src-f.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				put(
					"/dav/principals/test/cal/primary/dst-f.ics",
					makeCalEvent({
						uid: "copy-overwrite-false@example.com",
						summary: "Existing Destination",
						dtstart: "20260302T090000Z",
						dtend: "20260302T100000Z",
					}),
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				copy(
					"/dav/principals/test/cal/primary/src-f.ics",
					"/dav/principals/test/cal/primary/dst-f.ics",
					{ as: "test", overwrite: "F", expect: { status: 412 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 403 when source and destination are the same", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/same.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				copy(
					"/dav/principals/test/cal/primary/same.ics",
					"/dav/principals/test/cal/primary/same.ics",
					{ as: "test", expect: { status: 403 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 404 when source does not exist", async () => {
		const results = await runScript(
			[
				copy(
					"/dav/principals/test/cal/primary/nonexistent.ics",
					"/dav/principals/test/cal/primary/dest-404.ics",
					{ as: "test", expect: { status: 404 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 401 when unauthenticated", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/auth-src.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				copy(
					"/dav/principals/test/cal/primary/auth-src.ics",
					"/dav/principals/test/cal/primary/auth-dst.ics",
					// no `as` → unauthenticated
					{ expect: { status: 401 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 400 when Destination header is missing", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/no-dest.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				{
					name: "COPY without Destination header",
					method: "COPY",
					path: "/dav/principals/test/cal/primary/no-dest.ics",
					as: "test",
					expect: { status: 400 },
				},
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 502 when Destination is on a different server", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/cross-src.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				{
					name: "COPY to cross-server destination",
					method: "COPY",
					path: "/dav/principals/test/cal/primary/cross-src.ics",
					as: "test",
					headers: {
						Destination:
							"http://other-server.example.com/dav/principals/test/cal/primary/cross-dst.ics",
					},
					expect: { status: 502 },
				},
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 405 when copying the root path", async () => {
		const results = await runScript(
			[
				copy("/dav/", "/dav/principals/test/cal/primary/root-copy.ics", {
					as: "test",
					expect: { status: 405 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("copies an instance cross-collection", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/other/", {
					as: "test",
					expect: { status: 201 },
				}),
				put(
					"/dav/principals/test/cal/primary/cross-col.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				copy(
					"/dav/principals/test/cal/primary/cross-col.ics",
					"/dav/principals/test/cal/other/cross-col.ics",
					{ as: "test", expect: { status: 201 } },
				),
				get("/dav/principals/test/cal/other/cross-col.ics", {
					as: "test",
					expect: { status: 200, bodyContains: "Copy Test Event" },
				}),
				// Source still intact
				get("/dav/principals/test/cal/primary/cross-col.ics", {
					as: "test",
					expect: { status: 200 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});
});

// ---------------------------------------------------------------------------
// COPY collection
// ---------------------------------------------------------------------------

describe("COPY collection", () => {
	it("copies an empty collection to a new location (201)", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/src-empty/", {
					as: "test",
					expect: { status: 201 },
				}),
				copy(
					"/dav/principals/test/cal/src-empty/",
					"/dav/principals/test/cal/dst-empty/",
					{ as: "test", expect: { status: 201 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("source collection is still accessible after copy", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/col-src/", {
					as: "test",
					expect: { status: 201 },
				}),
				copy(
					"/dav/principals/test/cal/col-src/",
					"/dav/principals/test/cal/col-dst/",
					{ as: "test", expect: { status: 201 } },
				),
				propfind("/dav/principals/test/cal/col-src/", PROPFIND_ALLPROP, {
					as: "test",
					expect: { status: 207 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("Depth:infinity copies all instances into destination collection", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/deep-src/", {
					as: "test",
					expect: { status: 201 },
				}),
				put(
					"/dav/principals/test/cal/deep-src/event1.ics",
					makeCalEvent({
						uid: "deep-copy-ev1@example.com",
						summary: "Deep Copy Event 1",
						dtstart: "20260401T100000Z",
						dtend: "20260401T110000Z",
					}),
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				put(
					"/dav/principals/test/cal/deep-src/event2.ics",
					makeCalEvent({
						uid: "deep-copy-ev2@example.com",
						summary: "Deep Copy Event 2",
						dtstart: "20260402T100000Z",
						dtend: "20260402T110000Z",
					}),
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				copy(
					"/dav/principals/test/cal/deep-src/",
					"/dav/principals/test/cal/deep-dst/",
					{ as: "test", depth: "infinity", expect: { status: 201 } },
				),
				// Instances accessible in destination
				get("/dav/principals/test/cal/deep-dst/event1.ics", {
					as: "test",
					expect: { status: 200, bodyContains: "Deep Copy Event 1" },
				}),
				get("/dav/principals/test/cal/deep-dst/event2.ics", {
					as: "test",
					expect: { status: 200, bodyContains: "Deep Copy Event 2" },
				}),
				// Instances still in source
				get("/dav/principals/test/cal/deep-src/event1.ics", {
					as: "test",
					expect: { status: 200 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("Depth:0 copies only the collection itself (no instances)", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/shallow-src/", {
					as: "test",
					expect: { status: 201 },
				}),
				put(
					"/dav/principals/test/cal/shallow-src/event.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				copy(
					"/dav/principals/test/cal/shallow-src/",
					"/dav/principals/test/cal/shallow-dst/",
					{ as: "test", depth: "0", expect: { status: 201 } },
				),
				// Collection exists at destination
				propfind("/dav/principals/test/cal/shallow-dst/", PROPFIND_ALLPROP, {
					as: "test",
					expect: { status: 207 },
				}),
				// Instance NOT copied (depth:0 skips members)
				get("/dav/principals/test/cal/shallow-dst/event.ics", {
					as: "test",
					expect: { status: 404 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("Overwrite:T replaces existing destination collection (204)", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/ow-src/", {
					as: "test",
					expect: { status: 201 },
				}),
				mkcol("/dav/principals/test/cal/ow-dst/", {
					as: "test",
					expect: { status: 201 },
				}),
				copy(
					"/dav/principals/test/cal/ow-src/",
					"/dav/principals/test/cal/ow-dst/",
					{ as: "test", overwrite: "T", expect: { status: 204 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("Overwrite:F returns 412 when destination collection exists", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/owf-src/", {
					as: "test",
					expect: { status: 201 },
				}),
				mkcol("/dav/principals/test/cal/owf-dst/", {
					as: "test",
					expect: { status: 201 },
				}),
				copy(
					"/dav/principals/test/cal/owf-src/",
					"/dav/principals/test/cal/owf-dst/",
					{ as: "test", overwrite: "F", expect: { status: 412 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 403 when source and destination collection are the same", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/self-copy/", {
					as: "test",
					expect: { status: 201 },
				}),
				copy(
					"/dav/principals/test/cal/self-copy/",
					"/dav/principals/test/cal/self-copy/",
					{ as: "test", expect: { status: 403 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 401 when unauthenticated", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/auth-col/", {
					as: "test",
					expect: { status: 201 },
				}),
				copy(
					"/dav/principals/test/cal/auth-col/",
					"/dav/principals/test/cal/auth-col-dst/",
					// no `as` → unauthenticated
					{ expect: { status: 401 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
	});
});
