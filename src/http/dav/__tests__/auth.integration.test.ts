import { describe, expect, it } from "bun:test";
import { makeCalEvent } from "#src/testing/data.ts";
import {
	mkcol,
	PROPFIND_ALLPROP,
	propfind,
	put,
	twoUsers,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

const event = makeCalEvent({
	uid: "auth-test-001@example.com",
	summary: "Auth Test Event",
	dtstart: "20260115T100000Z",
	dtend: "20260115T110000Z",
});

describe("unauthenticated access", () => {
	// TODO: ACL enforcement not yet implemented — AclServiceAllowAll is used in tests.
	it.todo("PROPFIND on principal without auth returns 403");

	it("PUT without auth returns 403", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/alice/cal/primary/event.ics",
					event,
					"text/calendar; charset=utf-8",
					{ expect: { status: 403 } },
				),
			],
			twoUsers(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("MKCALENDAR without auth returns 403", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/alice/cal/new-cal/", {
					expect: { status: 403 },
				}),
			],
			twoUsers(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

describe("cross-user access (alice vs bob)", () => {
	// TODO: ACL enforcement not yet implemented — AclServiceAllowAll is used in tests.
	it.todo("Alice cannot PROPFIND Bob's collection");
	it.todo("Alice cannot PUT into Bob's collection");
	it.todo("Alice cannot REPORT (calendar-multiget) on Bob's collection");
});

describe("user isolation", () => {
	it("Alice and Bob can each create calendars and PUT events independently", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/alice/cal/alice-cal/", {
					as: "alice",
					expect: { status: 201 },
				}),
				mkcol("/dav/principals/bob/cal/bob-cal/", {
					as: "bob",
					expect: { status: 201 },
				}),
				put(
					"/dav/principals/alice/cal/alice-cal/event.ics",
					event,
					"text/calendar; charset=utf-8",
					{ as: "alice", expect: { status: 201 } },
				),
				put(
					"/dav/principals/bob/cal/bob-cal/event.ics",
					event,
					"text/calendar; charset=utf-8",
					{ as: "bob", expect: { status: 201 } },
				),
				propfind("/dav/principals/alice/cal/alice-cal/", PROPFIND_ALLPROP, {
					as: "alice",
					headers: { Depth: "1" },
					expect: { status: 207 },
				}),
				propfind("/dav/principals/bob/cal/bob-cal/", PROPFIND_ALLPROP, {
					as: "bob",
					headers: { Depth: "1" },
					expect: { status: 207 },
				}),
			],
			twoUsers(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});
