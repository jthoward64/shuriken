import { describe, expect, it } from "bun:test";
import { makeCalEvent, makeVCard } from "#src/testing/data.ts";
import {
	del,
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
	uid: "delete-test-001@example.com",
	summary: "Delete Test Event",
	dtstart: "20260201T090000Z",
	dtend: "20260201T100000Z",
});

const VCARD = makeVCard({
	uid: "delete-test-001@example.com",
	fn: "Delete Test Contact",
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
// DELETE instance
// ---------------------------------------------------------------------------

describe("DELETE instance", () => {
	it("returns 204 for an existing iCalendar instance", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/event.ics",
					EVENT,
					"text/calendar",
					{
						as: "test",
						expect: { status: 201 },
					},
				),
				del("/dav/principals/test/cal/primary/event.ics", {
					as: "test",
					expect: { status: 204 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 204 for an existing vCard instance", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/card/primary/contact.vcf",
					VCARD,
					"text/vcard",
					{
						as: "test",
						expect: { status: 201 },
					},
				),
				del("/dav/principals/test/card/primary/contact.vcf", {
					as: "test",
					expect: { status: 204 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("makes the deleted instance inaccessible (GET returns 404)", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/gone.ics",
					EVENT,
					"text/calendar",
					{
						as: "test",
						expect: { status: 201 },
					},
				),
				del("/dav/principals/test/cal/primary/gone.ics", {
					as: "test",
					expect: { status: 204 },
				}),
				get("/dav/principals/test/cal/primary/gone.ics", {
					as: "test",
					expect: { status: 404 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 404 when the instance does not exist", async () => {
		const results = await runScript(
			[
				del("/dav/principals/test/cal/primary/nonexistent.ics", {
					as: "test",
					expect: { status: 404 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 403 when unauthenticated", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/auth-event.ics",
					EVENT,
					"text/calendar",
					{
						as: "test",
						expect: { status: 201 },
					},
				),
				del("/dav/principals/test/cal/primary/auth-event.ics", {
					// no `as` → unauthenticated
					expect: { status: 403 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 405 for the root path", async () => {
		const results = await runScript(
			[del("/dav/", { as: "test", expect: { status: 405 } })],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 405 for the principal path", async () => {
		const results = await runScript(
			[del("/dav/principals/test", { as: "test", expect: { status: 405 } })],
			singleUser(),
		);
		expectAllPass(results);
	});
});

// ---------------------------------------------------------------------------
// DELETE collection
// ---------------------------------------------------------------------------

describe("DELETE collection", () => {
	it("returns 204 for an existing collection", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/to-delete/", {
					as: "test",
					expect: { status: 201 },
				}),
				del("/dav/principals/test/cal/to-delete/", {
					as: "test",
					expect: { status: 204 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("deletes all instances inside the collection", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/with-events/", {
					as: "test",
					expect: { status: 201 },
				}),
				put(
					"/dav/principals/test/cal/with-events/event1.ics",
					makeCalEvent({
						uid: "ev1@del",
						summary: "Event 1",
						dtstart: "20260301T100000Z",
						dtend: "20260301T110000Z",
					}),
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				put(
					"/dav/principals/test/cal/with-events/event2.ics",
					makeCalEvent({
						uid: "ev2@del",
						summary: "Event 2",
						dtstart: "20260302T100000Z",
						dtend: "20260302T110000Z",
					}),
					"text/calendar",
					{ as: "test", expect: { status: 201 } },
				),
				del("/dav/principals/test/cal/with-events/", {
					as: "test",
					expect: { status: 204 },
				}),
				// Instances must be gone
				get("/dav/principals/test/cal/with-events/event1.ics", {
					as: "test",
					expect: { status: 404 },
				}),
				get("/dav/principals/test/cal/with-events/event2.ics", {
					as: "test",
					expect: { status: 404 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("makes the collection inaccessible via PROPFIND after deletion", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/disappearing/", {
					as: "test",
					expect: { status: 201 },
				}),
				del("/dav/principals/test/cal/disappearing/", {
					as: "test",
					expect: { status: 204 },
				}),
				propfind("/dav/principals/test/cal/disappearing/", PROPFIND_ALLPROP, {
					as: "test",
					expect: { status: 404 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});

	it("returns 403 when unauthenticated", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/no-auth-del/", {
					as: "test",
					expect: { status: 201 },
				}),
				del("/dav/principals/test/cal/no-auth-del/", {
					// no `as` → unauthenticated
					expect: { status: 403 },
				}),
			],
			singleUser(),
		);
		expectAllPass(results);
	});
});
