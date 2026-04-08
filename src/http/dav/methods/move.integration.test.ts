import { describe, expect, it } from "bun:test";
import { makeCalEvent, makeVCard } from "#src/testing/data.ts";
import {
	get,
	mkcol,
	move,
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
	uid: "move-test-001@example.com",
	summary: "Move Test Event",
	dtstart: "20260401T090000Z",
	dtend: "20260401T100000Z",
});

const VCARD = makeVCard({
	uid: "move-test-001@example.com",
	fn: "Move Test Contact",
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
// MOVE instance
// ---------------------------------------------------------------------------

describe("MOVE instance", () => {
	it("renames an iCalendar instance within the same collection (201)", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/before.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				move(
					"/dav/principals/test/cal/primary/before.ics",
					"/dav/principals/test/cal/primary/after.ics",
					{ as: "test", expect: { status: 201 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("renames a vCard instance within the same collection (201)", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/card/primary/before.vcf",
					VCARD,
					"text/vcard",
					{ as: "test", expect: { status: 201 } },
				),
				move(
					"/dav/principals/test/card/primary/before.vcf",
					"/dav/principals/test/card/primary/after.vcf",
					{ as: "test", expect: { status: 201 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("source is inaccessible after MOVE", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/gone.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				move(
					"/dav/principals/test/cal/primary/gone.ics",
					"/dav/principals/test/cal/primary/arrived.ics",
					{ as: "test", expect: { status: 201 } },
				),
				get("/dav/principals/test/cal/primary/gone.ics", {
					as: "test",
					expect: { status: 404 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("destination is accessible with original content after MOVE", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/mv-src.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				move(
					"/dav/principals/test/cal/primary/mv-src.ics",
					"/dav/principals/test/cal/primary/mv-dst.ics",
					{ as: "test", expect: { status: 201 } },
				),
				get("/dav/principals/test/cal/primary/mv-dst.ics", {
					as: "test",
					expect: {
						status: 200,
						bodyContains: "Move Test Event",
					},
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("MOVE preserves the ETag (in-place relocation)", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/etag-src.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				move(
					"/dav/principals/test/cal/primary/etag-src.ics",
					"/dav/principals/test/cal/primary/etag-dst.ics",
					{ as: "test", expect: { status: 201 } },
				),
				get("/dav/principals/test/cal/primary/etag-dst.ics", {
					as: "test",
					expect: { status: 200 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
		// Source PUT ETag and destination GET ETag should match (preserved identity)
		const sourceEtag = results[0]?.headers.etag;
		const destEtag = results[2]?.headers.etag;
		expect(sourceEtag).toBeTruthy();
		expect(destEtag).toBeTruthy();
		expect(destEtag).toBe(sourceEtag);
	});

	it("moves an instance to a different collection (201)", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/other/", {
					as: "test",
					expect: { status: 201 },
				}),
				put(
					"/dav/principals/test/cal/primary/x-col.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				move(
					"/dav/principals/test/cal/primary/x-col.ics",
					"/dav/principals/test/cal/other/x-col.ics",
					{ as: "test", expect: { status: 201 } },
				),
				// Accessible at new location
				get("/dav/principals/test/cal/other/x-col.ics", {
					as: "test",
					expect: { status: 200, bodyContains: "Move Test Event" },
				}),
				// Gone from old location
				get("/dav/principals/test/cal/primary/x-col.ics", {
					as: "test",
					expect: { status: 404 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("Overwrite:T replaces existing destination (204)", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/ow-src.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				put(
					"/dav/principals/test/cal/primary/ow-dst.ics",
					makeCalEvent({
						uid: "move-overwrite-dst@example.com",
						summary: "Old Event at Destination",
						dtstart: "20260402T090000Z",
						dtend: "20260402T100000Z",
					}),
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				move(
					"/dav/principals/test/cal/primary/ow-src.ics",
					"/dav/principals/test/cal/primary/ow-dst.ics",
					{ as: "test", overwrite: "T", expect: { status: 204 } },
				),
				// Source gone
				get("/dav/principals/test/cal/primary/ow-src.ics", {
					as: "test",
					expect: { status: 404 },
				}),
				// Destination has source content
				get("/dav/principals/test/cal/primary/ow-dst.ics", {
					as: "test",
					expect: { status: 200, bodyContains: "Move Test Event" },
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
					"/dav/principals/test/cal/primary/owf-src.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				put(
					"/dav/principals/test/cal/primary/owf-dst.ics",
					makeCalEvent({
						uid: "move-overwrite-false@example.com",
						summary: "Existing Destination",
						dtstart: "20260402T090000Z",
						dtend: "20260402T100000Z",
					}),
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				move(
					"/dav/principals/test/cal/primary/owf-src.ics",
					"/dav/principals/test/cal/primary/owf-dst.ics",
					{ as: "test", overwrite: "F", expect: { status: 412 } },
				),
				// Source still intact (MOVE was rejected)
				get("/dav/principals/test/cal/primary/owf-src.ics", {
					as: "test",
					expect: { status: 200 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 403 when source and destination are the same", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/same-mv.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				move(
					"/dav/principals/test/cal/primary/same-mv.ics",
					"/dav/principals/test/cal/primary/same-mv.ics",
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
				move(
					"/dav/principals/test/cal/primary/nonexistent.ics",
					"/dav/principals/test/cal/primary/dest-404.ics",
					{ as: "test", expect: { status: 404 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 403 when unauthenticated", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/auth-mv.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				move(
					"/dav/principals/test/cal/primary/auth-mv.ics",
					"/dav/principals/test/cal/primary/auth-mv-dst.ics",
					// no `as` → unauthenticated
					{ expect: { status: 403 } },
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
					"/dav/principals/test/cal/primary/no-dest-mv.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				{
					name: "MOVE without Destination header",
					method: "MOVE",
					path: "/dav/principals/test/cal/primary/no-dest-mv.ics",
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
					"/dav/principals/test/cal/primary/cross-mv.ics",
					EVENT,
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				{
					name: "MOVE to cross-server destination",
					method: "MOVE",
					path: "/dav/principals/test/cal/primary/cross-mv.ics",
					as: "test",
					headers: {
						Destination:
							"http://other-server.example.com/dav/principals/test/cal/primary/cross-mv-dst.ics",
					},
					expect: { status: 502 },
				},
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 405 for the root path", async () => {
		const results = await runScript(
			[
				move("/dav/", "/dav/principals/test/cal/primary/root-mv.ics", {
					as: "test",
					expect: { status: 405 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});
});

// ---------------------------------------------------------------------------
// MOVE collection
// ---------------------------------------------------------------------------

describe("MOVE collection", () => {
	it("renames a collection (201)", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/rename-src/", {
					as: "test",
					expect: { status: 201 },
				}),
				move(
					"/dav/principals/test/cal/rename-src/",
					"/dav/principals/test/cal/rename-dst/",
					{ as: "test", expect: { status: 201 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("source collection is inaccessible after MOVE", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/mv-col-src/", {
					as: "test",
					expect: { status: 201 },
				}),
				move(
					"/dav/principals/test/cal/mv-col-src/",
					"/dav/principals/test/cal/mv-col-dst/",
					{ as: "test", expect: { status: 201 } },
				),
				propfind("/dav/principals/test/cal/mv-col-src/", PROPFIND_ALLPROP, {
					as: "test",
					expect: { status: 404 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("destination collection is accessible after MOVE", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/here/", {
					as: "test",
					expect: { status: 201 },
				}),
				move(
					"/dav/principals/test/cal/here/",
					"/dav/principals/test/cal/there/",
					{ as: "test", expect: { status: 201 } },
				),
				propfind("/dav/principals/test/cal/there/", PROPFIND_ALLPROP, {
					as: "test",
					expect: { status: 207 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("instances follow the collection to the new path", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/with-items/", {
					as: "test",
					expect: { status: 201 },
				}),
				put(
					"/dav/principals/test/cal/with-items/event1.ics",
					makeCalEvent({
						uid: "mv-col-ev1@example.com",
						summary: "Moved Collection Event 1",
						dtstart: "20260501T100000Z",
						dtend: "20260501T110000Z",
					}),
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				put(
					"/dav/principals/test/cal/with-items/event2.ics",
					makeCalEvent({
						uid: "mv-col-ev2@example.com",
						summary: "Moved Collection Event 2",
						dtstart: "20260502T100000Z",
						dtend: "20260502T110000Z",
					}),
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				move(
					"/dav/principals/test/cal/with-items/",
					"/dav/principals/test/cal/relocated/",
					{ as: "test", expect: { status: 201 } },
				),
				// Instances accessible at new collection path
				get("/dav/principals/test/cal/relocated/event1.ics", {
					as: "test",
					expect: { status: 200, bodyContains: "Moved Collection Event 1" },
				}),
				get("/dav/principals/test/cal/relocated/event2.ics", {
					as: "test",
					expect: { status: 200, bodyContains: "Moved Collection Event 2" },
				}),
				// Old paths no longer work
				get("/dav/principals/test/cal/with-items/event1.ics", {
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
				mkcol("/dav/principals/test/cal/mv-ow-src/", {
					as: "test",
					expect: { status: 201 },
				}),
				mkcol("/dav/principals/test/cal/mv-ow-dst/", {
					as: "test",
					expect: { status: 201 },
				}),
				move(
					"/dav/principals/test/cal/mv-ow-src/",
					"/dav/principals/test/cal/mv-ow-dst/",
					{ as: "test", overwrite: "T", expect: { status: 204 } },
				),
				// Source gone
				propfind("/dav/principals/test/cal/mv-ow-src/", PROPFIND_ALLPROP, {
					as: "test",
					expect: { status: 404 },
				}),
				// Destination still accessible
				propfind("/dav/principals/test/cal/mv-ow-dst/", PROPFIND_ALLPROP, {
					as: "test",
					expect: { status: 207 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("Overwrite:F returns 412 when destination collection exists", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/mv-owf-src/", {
					as: "test",
					expect: { status: 201 },
				}),
				mkcol("/dav/principals/test/cal/mv-owf-dst/", {
					as: "test",
					expect: { status: 201 },
				}),
				move(
					"/dav/principals/test/cal/mv-owf-src/",
					"/dav/principals/test/cal/mv-owf-dst/",
					{ as: "test", overwrite: "F", expect: { status: 412 } },
				),
				// Source still accessible (MOVE was rejected)
				propfind("/dav/principals/test/cal/mv-owf-src/", PROPFIND_ALLPROP, {
					as: "test",
					expect: { status: 207 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 400 when Depth header is not infinity", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/depth-src/", {
					as: "test",
					expect: { status: 201 },
				}),
				{
					name: "MOVE collection with Depth:0 (invalid)",
					method: "MOVE",
					path: "/dav/principals/test/cal/depth-src/",
					as: "test",
					headers: {
						Destination: "http://localhost/dav/principals/test/cal/depth-dst/",
						Depth: "0",
					},
					expect: { status: 400 },
				},
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 403 when source and destination are the same", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/self-mv/", {
					as: "test",
					expect: { status: 201 },
				}),
				move(
					"/dav/principals/test/cal/self-mv/",
					"/dav/principals/test/cal/self-mv/",
					{ as: "test", expect: { status: 403 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 403 when unauthenticated", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/auth-mv-col/", {
					as: "test",
					expect: { status: 201 },
				}),
				move(
					"/dav/principals/test/cal/auth-mv-col/",
					"/dav/principals/test/cal/auth-mv-col-dst/",
					// no `as` → unauthenticated
					{ expect: { status: 403 } },
				),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 400 when Destination header is missing", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/no-dest-mv-col/", {
					as: "test",
					expect: { status: 201 },
				}),
				{
					name: "MOVE collection without Destination header",
					method: "MOVE",
					path: "/dav/principals/test/cal/no-dest-mv-col/",
					as: "test",
					expect: { status: 400 },
				},
			],
			singleUser(),
		);
		expectAllPass(results);
	});
});
