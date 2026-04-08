import { describe, expect, it } from "bun:test";
import {
	PROPFIND_ALLPROP,
	PROPFIND_RESOURCETYPE,
	propfind,
	singleUser,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

const PROPFIND_SYNC_TOKEN = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:sync-token/>
  </D:prop>
</D:propfind>`;

describe("default collections", () => {
	it("provisioned user has a primary calendar collection", async () => {
		const results = await runScript(
			[
				propfind("/dav/principals/test/cal/primary/", PROPFIND_ALLPROP, {
					as: "test",
					headers: { Depth: "0" },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("provisioned user has a primary address book collection", async () => {
		const results = await runScript(
			[
				propfind("/dav/principals/test/card/primary/", PROPFIND_ALLPROP, {
					as: "test",
					headers: { Depth: "0" },
				}),
			],
			singleUser(),
		);

		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// RFC 4791 §4.2: calendar collections must have resourcetype containing caldav:calendar.
	it("primary calendar collection has caldav:calendar in resourcetype", async () => {
		const results = await runScript(
			[
				propfind("/dav/principals/test/cal/primary/", PROPFIND_RESOURCETYPE, {
					as: "test",
					headers: { Depth: "0" },
					expect: { status: 207, bodyContains: "calendar" },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// RFC 6352 §5.2: addressbook collections must have resourcetype containing carddav:addressbook.
	it("primary addressbook collection has carddav:addressbook in resourcetype", async () => {
		const results = await runScript(
			[
				propfind("/dav/principals/test/card/primary/", PROPFIND_RESOURCETYPE, {
					as: "test",
					headers: { Depth: "0" },
					expect: { status: 207, bodyContains: "addressbook" },
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// RFC 6578 §3: sync-token must be present on any collection that supports
	// collection synchronisation. The token is a URN.
	it("primary calendar collection has a sync-token in URN format", async () => {
		const results = await runScript(
			[
				propfind("/dav/principals/test/cal/primary/", PROPFIND_SYNC_TOKEN, {
					as: "test",
					headers: { Depth: "0" },
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
	});
});
