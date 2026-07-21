import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import {
	get,
	propfind,
	put,
	report,
	singleUser,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

// ---------------------------------------------------------------------------
// End-to-end vCard version canonicalization + negotiation (RFC 6352):
//   * ingest upgrades any 3.0 card to canonical 4.0 (TYPE=pref → PREF=1)
//   * serve downgrades to 3.0 only when the client negotiates it
//   * the address book advertises CARDDAV:supported-address-data
// ---------------------------------------------------------------------------

const CARD_PATH = "/dav/principals/test/card/primary/pref.vcf";
const COLLECTION = "/dav/principals/test/card/primary/";

const v3Card = [
	"BEGIN:VCARD",
	"VERSION:3.0",
	"FN:Pref Person",
	"N:Person;Pref;;;",
	"EMAIL;TYPE=INTERNET;TYPE=pref:pref@example.com",
	"UID:nego-pref@example.com",
	"END:VCARD",
	"",
].join("\r\n");

const SETUP = [
	put(CARD_PATH, v3Card, "text/vcard; charset=utf-8", {
		as: "test",
		expect: { status: 201 },
	}),
];

const queryAll = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <C:filter test="anyof"/>
</C:addressbook-query>`;

const queryAllV3 = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:address-data content-type="text/vcard" version="3.0"/>
  </D:prop>
  <C:filter test="anyof"/>
</C:addressbook-query>`;

const propfindSupportedData = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <C:supported-address-data/>
  </D:prop>
</D:propfind>`;

const assertNoFailures = (
	results: Awaited<ReturnType<typeof runScript>>,
): void => {
	for (const result of results) {
		expect(result.failures, result.step.name).toEqual([]);
	}
};

describe("vCard version negotiation", () => {
	it("upgrades a 3.0 card to canonical 4.0 on ingest (GET without Accept)", async () => {
		const results = await runScript(
			[
				...SETUP,
				get(CARD_PATH, {
					as: "test",
					expect: {
						status: 200,
						bodyContains: ["VERSION:4.0", "PREF=1"],
						bodyNotContains: ["VERSION:3.0", "TYPE=pref"],
					},
				}),
			],
			singleUser(),
		);
		assertNoFailures(results);
	});

	it("downgrades to 3.0 when the client sends Accept: version=3.0", async () => {
		const results = await runScript(
			[
				...SETUP,
				get(CARD_PATH, {
					as: "test",
					headers: { Accept: "text/vcard; version=3.0" },
					expect: {
						status: 200,
						bodyContains: ["VERSION:3.0", "pref"],
						bodyNotContains: ["VERSION:4.0", "PREF=1"],
					},
				}),
			],
			singleUser(),
		);
		assertNoFailures(results);
	});

	it("serves 4.0 by default and 3.0 via the address-data version attr in a query", async () => {
		const results = await runScript(
			[
				...SETUP,
				report(COLLECTION, queryAll, {
					as: "test",
					expect: { status: 207, bodyContains: ["VERSION:4.0"] },
				}),
				report(COLLECTION, queryAllV3, {
					as: "test",
					expect: { status: 207, bodyContains: ["VERSION:3.0"] },
				}),
			],
			singleUser(),
		);
		assertNoFailures(results);
	});

	it("advertises CARDDAV:supported-address-data on the address book", async () => {
		const results = await runScript(
			[
				...SETUP,
				propfind(COLLECTION, propfindSupportedData, {
					as: "test",
					headers: { Depth: "0" },
					expect: {
						status: 207,
						bodyContains: [
							"supported-address-data",
							"address-data-type",
							"3.0",
							"4.0",
						],
					},
				}),
			],
			singleUser(),
		);
		assertNoFailures(results);
	});
});
