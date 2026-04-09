import { describe, expect, it } from "bun:test";
import { makeCalEvent, makeVCard } from "#src/testing/data.ts";
import {
	del,
	mkcol,
	propfind,
	put,
	report,
	singleUser,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

// ---------------------------------------------------------------------------
// Sample events
// ---------------------------------------------------------------------------

const event1 = makeCalEvent({
	uid: "sync-001@example.com",
	summary: "Sync Event One",
	dtstart: "20260115T100000Z",
	dtend: "20260115T110000Z",
});

const event2 = makeCalEvent({
	uid: "sync-002@example.com",
	summary: "Sync Event Two",
	dtstart: "20260215T100000Z",
	dtend: "20260215T110000Z",
});

const event3 = makeCalEvent({
	uid: "sync-003@example.com",
	summary: "Sync Event Three",
	dtstart: "20260315T100000Z",
	dtend: "20260315T110000Z",
});

// ---------------------------------------------------------------------------
// Sync-collection XML body builders
// ---------------------------------------------------------------------------

const syncInitial = `<?xml version="1.0" encoding="utf-8"?>
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token/>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:sync-collection>`;

const syncWithToken = (
	token: string,
): string => `<?xml version="1.0" encoding="utf-8"?>
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token>${token}</D:sync-token>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:sync-collection>`;

const syncMalformedToken = `<?xml version="1.0" encoding="utf-8"?>
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token>not-a-valid-token</D:sync-token>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:sync-collection>`;

const syncFutureToken = `<?xml version="1.0" encoding="utf-8"?>
<D:sync-collection xmlns:D="DAV:">
  <D:sync-token>urn:ietf:params:xml:ns:sync:999999</D:sync-token>
  <D:sync-level>1</D:sync-level>
  <D:prop>
    <D:getetag/>
  </D:prop>
</D:sync-collection>`;

// Helper to extract sync-token value from a multistatus XML body
const extractSyncToken = (body: string): string => {
	const match = body.match(/urn:ietf:params:xml:ns:sync:\d+/);
	return match?.[0] ?? "";
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sync-collection REPORT — initial sync", () => {
	it("initial sync on empty collection returns sync-token and no instances", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/sync-cal/", {
					as: "test",
					expect: { status: 201 },
				}),
				report("/dav/principals/test/cal/sync-cal/", syncInitial, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: "urn:ietf:params:xml:ns:sync:",
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		// No instance UIDs in the response (empty collection)
		expect(results[1]?.body).not.toContain("sync-00");
	});

	it("initial sync after PUT two events lists both instances", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/sync-cal/", {
					as: "test",
					expect: { status: 201 },
				}),
				put(
					"/dav/principals/test/cal/sync-cal/event1.ics",
					event1,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				put(
					"/dav/principals/test/cal/sync-cal/event2.ics",
					event2,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				report("/dav/principals/test/cal/sync-cal/", syncInitial, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: "urn:ietf:params:xml:ns:sync:",
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		// Both instances should appear as separate <D:href> entries
		const syncBody = results[3]?.body ?? "";
		const hrefCount = (syncBody.match(/<D:href>/g) ?? []).length;
		expect(hrefCount).toBe(2);
	});
});

describe("sync-collection REPORT — delta sync", () => {
	it("delta with PROPFIND-derived token and no changes returns empty response", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/sync-cal/", {
					as: "test",
					expect: { status: 201 },
				}),
				put(
					"/dav/principals/test/cal/sync-cal/event1.ics",
					event1,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				// PROPFIND to get the current sync-token
				propfind(
					"/dav/principals/test/cal/sync-cal/",
					`<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop><D:sync-token/></D:prop>
</D:propfind>`,
					{
						as: "test",
						headers: { Depth: "0" },
						expect: { status: 207 },
					},
				),
				// Delta sync with the token just retrieved — no changes, empty result
				(prev) => {
					const syncToken = extractSyncToken(prev[2]?.body ?? "");
					return report(
						"/dav/principals/test/cal/sync-cal/",
						syncWithToken(syncToken),
						{
							as: "test",
							expect: {
								status: 207,
								bodyNotContains: "event1.ics",
							},
						},
					);
				},
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("delta sync after adding a new event returns only the new event", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/sync-cal/", {
					as: "test",
					expect: { status: 201 },
				}),
				put(
					"/dav/principals/test/cal/sync-cal/event1.ics",
					event1,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				put(
					"/dav/principals/test/cal/sync-cal/event2.ics",
					event2,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				// Initial sync — captures both events and the current token
				report("/dav/principals/test/cal/sync-cal/", syncInitial, {
					as: "test",
					expect: { status: 207 },
				}),
				// Add a third event after the initial sync
				put(
					"/dav/principals/test/cal/sync-cal/event3.ics",
					event3,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				// Delta sync with token from step 3 — only event3 should appear
				(prev) => {
					const syncToken = extractSyncToken(prev[3]?.body ?? "");
					return report(
						"/dav/principals/test/cal/sync-cal/",
						syncWithToken(syncToken),
						{
							as: "test",
							expect: { status: 207 },
						},
					);
				},
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		// Delta response should contain exactly 1 href (event3 only)
		const deltaBody = results[5]?.body ?? "";
		const hrefCount = (deltaBody.match(/<D:href>/g) ?? []).length;
		expect(hrefCount).toBe(1);
	});
});

describe("sync-collection REPORT — error cases", () => {
	it("malformed token returns 409 DAV:valid-sync-token", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/sync-cal/", {
					as: "test",
					expect: { status: 201 },
				}),
				report("/dav/principals/test/cal/sync-cal/", syncMalformedToken, {
					as: "test",
					expect: {
						status: 409,
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("future token (ahead of server) returns 409 DAV:valid-sync-token", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/sync-cal/", {
					as: "test",
					expect: { status: 201 },
				}),
				report("/dav/principals/test/cal/sync-cal/", syncFutureToken, {
					as: "test",
					expect: {
						status: 409,
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// RFC 6578 §3.2: when a collection member is deleted, the server MUST report
	// a DAV:response for the deleted member URI with a DAV:status of 404 (Not Found)
	// in the next delta sync after the deletion.
	it("delta sync after DELETE reports deleted instance as 404", async () => {
		const results = await runScript(
			[
				mkcol("/dav/principals/test/cal/sync-cal/", {
					as: "test",
					expect: { status: 201 },
				}),
				put(
					"/dav/principals/test/cal/sync-cal/event1.ics",
					event1,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				// Capture the current sync-token before the deletion
				report("/dav/principals/test/cal/sync-cal/", syncInitial, {
					as: "test",
					expect: { status: 207 },
				}),
				// Delete the event
				del("/dav/principals/test/cal/sync-cal/event1.ics", {
					as: "test",
					expect: { status: 204 },
				}),
				// Delta sync — deleted item must appear with 404
				(prev) => {
					const syncToken = extractSyncToken(prev[2]?.body ?? "");
					return report(
						"/dav/principals/test/cal/sync-cal/",
						syncWithToken(syncToken),
						{
							as: "test",
							expect: {
								status: 207,
								bodyContains: "404",
							},
						},
					);
				},
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		// The deleted href must appear in the response, not be silently omitted
		expect(results[4]?.body).toContain("event1.ics");
	});

	it("sync-collection on an instance path returns 405", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/cal/primary/event.ics",
					event1,
					"text/calendar; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				report("/dav/principals/test/cal/primary/event.ics", syncInitial, {
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
});

// ---------------------------------------------------------------------------
// Addressbook sync
// ---------------------------------------------------------------------------

const contact1 = makeVCard({
	uid: "sync-card-001@example.com",
	fn: "Sync Contact One",
});
const contact2 = makeVCard({
	uid: "sync-card-002@example.com",
	fn: "Sync Contact Two",
});

describe("sync-collection REPORT — addressbook", () => {
	// RFC 6578 applies to any WebDAV collection type, not just calendars.
	// The primary addressbook is provisioned automatically; verify sync works on it.
	it("initial sync on addressbook with contacts returns both hrefs", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/card/primary/c1.vcf",
					contact1,
					"text/vcard; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				put(
					"/dav/principals/test/card/primary/c2.vcf",
					contact2,
					"text/vcard; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				report("/dav/principals/test/card/primary/", syncInitial, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: "urn:ietf:params:xml:ns:sync:",
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		const syncBody = results[2]?.body ?? "";
		const hrefCount = (syncBody.match(/<D:href>/g) ?? []).length;
		expect(hrefCount).toBe(2);
	});

	it("delta sync on addressbook after adding a contact returns only the new contact", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/card/primary/c1.vcf",
					contact1,
					"text/vcard; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				// Capture sync-token after first PUT
				report("/dav/principals/test/card/primary/", syncInitial, {
					as: "test",
					expect: { status: 207 },
				}),
				// Add a second contact after the snapshot
				put(
					"/dav/principals/test/card/primary/c2.vcf",
					contact2,
					"text/vcard; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				// Delta sync — only c2 should appear
				(prev) => {
					const syncToken = extractSyncToken(prev[1]?.body ?? "");
					return report(
						"/dav/principals/test/card/primary/",
						syncWithToken(syncToken),
						{
							as: "test",
							expect: { status: 207 },
						},
					);
				},
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		const deltaBody = results[3]?.body ?? "";
		const hrefCount = (deltaBody.match(/<D:href>/g) ?? []).length;
		expect(hrefCount).toBe(1);
		// sync-collection uses stable UUID hrefs for member resources
		expect(deltaBody).toMatch(
			/\/dav\/principals\/test\/card\/primary\/[0-9a-f-]{36}/,
		);
	});
});
