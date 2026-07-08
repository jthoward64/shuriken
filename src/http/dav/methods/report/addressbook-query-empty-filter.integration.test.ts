import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { makeVCard } from "#src/testing/data.ts";
import {
	put,
	report,
	singleUser,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

// Regression: iOS Contacts issues an addressbook-query with an EMPTY <filter/>
// to fetch the whole address book. RFC 6352 §10.5.1 says an empty filter matches
// every card, but the server used to reject it with 403 CARDDAV:valid-filter,
// so contacts never synced.

const CONTACT = makeVCard({
	uid: "empty-filter-contact@example.com",
	fn: "Filter Test",
});

const EMPTY_FILTER_QUERY = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop><D:getetag/><C:address-data/></D:prop>
  <C:filter/>
</C:addressbook-query>`;

describe("addressbook-query with an empty filter", () => {
	it("matches all cards (RFC 6352 §10.5.1) instead of 403ing", async () => {
		const results = await runScript(
			[
				put(
					"/dav/principals/test/card/primary/c.vcf",
					CONTACT,
					"text/vcard; charset=utf-8",
					{ as: "test", expect: { status: 201 } },
				),
				report("/dav/principals/test/card/primary/", EMPTY_FILTER_QUERY, {
					as: "test",
					headers: { Depth: "1" },
					expect: { status: 207 },
				}),
			],
			singleUser(),
		);
		for (const r of results) {
			expect(r.failures, r.step.name).toEqual([]);
		}
		const body = results[1]?.body ?? "";
		expect(body).toContain("/dav/principals/test/card/primary/c.vcf");
		expect(body).toContain("Filter Test");
	});
});
