import { describe, expect, it } from "bun:test";
import { makeCalEvent, makeVCard } from "#src/testing/data.ts";
import {
	get,
	mkcol,
	PROPFIND_ALLPROP,
	propfind,
	put,
	singleUser,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const eventV1 = makeCalEvent({
	uid: "lifecycle-001@example.com",
	summary: "Original Summary",
	dtstart: "20260115T100000Z",
	dtend: "20260115T110000Z",
});

const eventV2 = makeCalEvent({
	uid: "lifecycle-001@example.com",
	summary: "Updated Summary",
	dtstart: "20260115T120000Z",
	dtend: "20260115T130000Z",
});

const vcard = makeVCard({
	uid: "lifecycle-001@example.com",
	fn: "Lifecycle Contact",
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PUT → GET lifecycle", () => {
	it("GET after PUT returns the correct body and headers", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/event.ics",
					eventV1,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				get("/dav/principals/test/cal/primary/event.ics", {
					as: "test",
					expect: {
						status: 200,
						bodyContains: ["lifecycle-001@example.com", "Original Summary"],
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		const getResult = results[1];
		expect(getResult?.headers["content-type"]).toContain("text/calendar");
		expect(getResult?.headers.etag).toBeTruthy();
	});

	it("vCard GET after PUT returns correct Content-Type and FN", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/card/primary/contact.vcf",
					vcard,
					"text/vcard; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				get("/dav/principals/test/card/primary/contact.vcf", {
					as: "test",
					expect: {
						status: 200,
						bodyContains: "Lifecycle Contact",
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		const getResult = results[1];
		expect(getResult?.headers["content-type"]).toContain("text/vcard");
	});
});

describe("PUT → PROPFIND Depth:1 shows instance", () => {
	it("instance URL appears in collection listing after PUT", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/new-cal/", {
					as: "test",
					expect: { status: 201 },
				}),
				put(
					"/dav/principals/test/cal/new-cal/event.ics",
					eventV1,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				propfind("/dav/principals/test/cal/new-cal/", PROPFIND_ALLPROP, {
					as: "test",
					headers: { Depth: "1" },
					expect: {
						status: 207,
						bodyContains: "text/calendar",
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

describe("PUT update with conditional headers", () => {
	it("unconditional overwrite returns 204", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/event.ics",
					eventV1,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				put(
					"/dav/principals/test/cal/primary/event.ics",
					eventV2,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 204 } },
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("PUT with matching If-Match returns 204 and updated body is retrievable", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/match-event.ics",
					eventV1,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				// Use the ETag from step 0 in the If-Match header of step 1
				(prev) =>
					put(
						"/dav/principals/test/cal/primary/match-event.ics",
						eventV2,
						"text/calendar; charset=utf-8",
						{
							as: "test",
							headers: { "If-Match": prev[0]?.headers.etag ?? "" },
							expect: { status: 204 },
						},
					),
				get("/dav/principals/test/cal/primary/match-event.ics", {
					as: "test",
					expect: {
						status: 200,
						bodyContains: "Updated Summary",
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("PUT with wrong If-Match returns 412", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/wrong-match.ics",
					eventV1,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				put(
					"/dav/principals/test/cal/primary/wrong-match.ics",
					eventV2,
					"text/calendar; charset=utf-8",
					{
						as: "test",
						headers: { "If-Match": '"this-etag-does-not-match"' },
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

	it("PUT with If-None-Match: * on existing resource returns 412", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/none-match.ics",
					eventV1,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				put(
					"/dav/principals/test/cal/primary/none-match.ics",
					eventV2,
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

	it("PUT with If-None-Match: * on new resource creates it (201)", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/new-none-match.ics",
					eventV1,
					"text/calendar; charset=utf-8",
					{
						as: "test",
						headers: { "If-None-Match": "*" },
						expect: { status: 201 },
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
