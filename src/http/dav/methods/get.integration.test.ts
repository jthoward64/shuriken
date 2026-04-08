import { describe, expect, it } from "bun:test";
import { makeCalEvent, makeVCard } from "#src/testing/data.ts";
import { get, put, singleUser } from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

const EVENT_UID = "get-test-001@example.com";
const EVENT = makeCalEvent({
	uid: EVENT_UID,
	summary: "Get Test Event",
	dtstart: "20260115T100000Z",
	dtend: "20260115T110000Z",
});

const VCARD_UID = "get-test-001@example.com";
const VCARD = makeVCard({ uid: VCARD_UID, fn: "Get Test Contact" });

describe("GET", () => {
	it("returns the iCalendar body with correct headers after PUT", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/event.ics",
					EVENT,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				get("/dav/principals/test/cal/primary/event.ics", {
					as: "test",
					expect: {
						status: 200,
						bodyContains: EVENT_UID,
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

	it("returns the vCard body with correct Content-Type after PUT", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/card/primary/contact.vcf",
					VCARD,
					"text/vcard; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				get("/dav/principals/test/card/primary/contact.vcf", {
					as: "test",
					expect: {
						status: 200,
						bodyContains: VCARD_UID,
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

	it("returns 405 on a collection URL", async () => {
		const results = await runScript(
			[
				get("/dav/principals/test/cal/primary/", {
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

	// RFC 4918 §9.4: GET is not defined on collection or principal resources.
	it("returns 405 on a principal URL", async () => {
		const results = await runScript(
			[
				get("/dav/principals/test/", {
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

	it("returns 404 on an unknown instance path (new-instance kind)", async () => {
		const results = await runScript(
			[
				get("/dav/principals/test/cal/primary/no-such-event.ics", {
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

	// RFC 7232 §3.3: If-None-Match: * on a resource that exists must return 304 or
	// the full response depending on whether the server implements conditional GETs.
	// The ETag from PUT must round-trip through the GET response.
	it("ETag in GET response matches ETag returned by PUT", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/etag-check.ics",
					EVENT,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				get("/dav/principals/test/cal/primary/etag-check.ics", {
					as: "test",
					expect: { status: 200 },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		const putEtag = results[0]?.headers.etag;
		const getEtag = results[1]?.headers.etag;
		expect(putEtag).toBeTruthy();
		expect(getEtag).toBeTruthy();
		expect(getEtag).toBe(putEtag);
	});
});

describe("HEAD", () => {
	it("returns 200 with headers but empty body", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/head-event.ics",
					EVENT,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				{
					name: "HEAD event",
					method: "GET",
					path: "/dav/principals/test/cal/primary/head-event.ics",
					as: "test",
					headers: {},
					expect: { status: 200 },
				},
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		const headResult = results[1];
		expect(headResult?.headers.etag).toBeTruthy();
		expect(headResult?.headers["content-type"]).toContain("text/calendar");
	});
});
