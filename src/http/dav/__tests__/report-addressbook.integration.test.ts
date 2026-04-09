import { describe, expect, it } from "bun:test";
import { makeVCard } from "#src/testing/data.ts";
import {
	put,
	report,
	singleUser,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

// ---------------------------------------------------------------------------
// Sample contacts
// ---------------------------------------------------------------------------

const ALICE_UID = "report-card-alice@example.com";
const BOB_UID = "report-card-bob@example.com";

const aliceCard = makeVCard({ uid: ALICE_UID, fn: "Alice Smith" });
const bobCard = makeVCard({ uid: BOB_UID, fn: "Bob Jones" });

// ---------------------------------------------------------------------------
// Shared setup steps — use the provisioned primary addressbook
// ---------------------------------------------------------------------------

const SETUP = [
	put(
		"/dav/principals/test/card/primary/alice.vcf",
		aliceCard,
		"text/vcard; charset=utf-8",
		{ as: "test", expect: { status: 201 } },
	),
	put(
		"/dav/principals/test/card/primary/bob.vcf",
		bobCard,
		"text/vcard; charset=utf-8",
		{ as: "test", expect: { status: 201 } },
	),
];

// ---------------------------------------------------------------------------
// addressbook-multiget bodies
// ---------------------------------------------------------------------------

const multigetBoth = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-multiget xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <D:href>/dav/principals/test/card/primary/alice.vcf</D:href>
  <D:href>/dav/principals/test/card/primary/bob.vcf</D:href>
</C:addressbook-multiget>`;

const multigetAliceOnly = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-multiget xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <D:href>/dav/principals/test/card/primary/alice.vcf</D:href>
</C:addressbook-multiget>`;

const multigetWithMissing = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-multiget xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <D:href>/dav/principals/test/card/primary/alice.vcf</D:href>
  <D:href>/dav/principals/test/card/primary/does-not-exist.vcf</D:href>
</C:addressbook-multiget>`;

// ---------------------------------------------------------------------------
// addressbook-query bodies
// ---------------------------------------------------------------------------

const queryAll = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <C:filter test="anyof"/>
</C:addressbook-query>`;

const queryFnContainsAlice = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <C:filter test="anyof">
    <C:prop-filter name="FN">
      <C:text-match collation="i;unicode-casemap" match-type="contains">Alice</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>`;

const queryFnNotAlice = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <C:filter test="anyof">
    <C:prop-filter name="FN">
      <C:text-match collation="i;unicode-casemap" match-type="contains" negate-condition="yes">Alice</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>`;

const queryFnStartsWithBob = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <C:filter test="anyof">
    <C:prop-filter name="FN">
      <C:text-match collation="i;unicode-casemap" match-type="starts-with">Bob</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>`;

const queryFnEndsWithSmith = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <C:filter test="anyof">
    <C:prop-filter name="FN">
      <C:text-match collation="i;unicode-casemap" match-type="ends-with">Smith</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>`;

const queryFnEqualsAliceSmith = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <C:filter test="anyof">
    <C:prop-filter name="FN">
      <C:text-match collation="i;unicode-casemap" match-type="equals">Alice Smith</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>`;

// address-data subsetting: return only UID and FN (not the full vCard body)
// RFC 6352 §8.6.1 — <C:address-data> may contain <C:prop name="..."/> children
// to restrict the returned properties.
const multigetAliceSubsetted = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-multiget xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:address-data>
      <C:prop name="UID"/>
      <C:prop name="FN"/>
    </C:address-data>
  </D:prop>
  <D:href>/dav/principals/test/card/primary/alice.vcf</D:href>
</C:addressbook-multiget>`;

// addressbook-multiget with no hrefs — should return 207 with no resource responses
// RFC 6352 §8.7: analogous to calendar-multiget; an empty href list is valid
const multigetNoHrefs = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-multiget xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
</C:addressbook-multiget>`;

// anyof: match FN contains Alice OR FN contains Bob → both
const queryAnyof = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <C:filter test="anyof">
    <C:prop-filter name="FN">
      <C:text-match collation="i;unicode-casemap" match-type="contains">Alice</C:text-match>
    </C:prop-filter>
    <C:prop-filter name="FN">
      <C:text-match collation="i;unicode-casemap" match-type="contains">Bob</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>`;

// allof: match FN contains Alice AND FN contains Bob → impossible, empty
const queryAllof = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <C:filter test="allof">
    <C:prop-filter name="FN">
      <C:text-match collation="i;unicode-casemap" match-type="contains">Alice</C:text-match>
    </C:prop-filter>
    <C:prop-filter name="FN">
      <C:text-match collation="i;unicode-casemap" match-type="contains">Bob</C:text-match>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>`;

// is-not-defined on EMAIL (not present in test vCards) → both contacts match
// RFC 6352 §10.5.1: prop-filter with is-not-defined matches vCards that
// do NOT have the named property.
const queryEmailIsNotDefined = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
  <C:filter test="anyof">
    <C:prop-filter name="EMAIL">
      <C:is-not-defined/>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>`;

// is-not-defined on FN (which always exists) → no results
const queryFnIsNotDefined = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
  <C:filter test="anyof">
    <C:prop-filter name="FN">
      <C:is-not-defined/>
    </C:prop-filter>
  </C:filter>
</C:addressbook-query>`;

const queryMissingFilter = `<?xml version="1.0" encoding="utf-8"?>
<C:addressbook-query xmlns:C="urn:ietf:params:xml:ns:carddav" xmlns:D="DAV:">
  <D:prop>
    <D:getetag/>
  </D:prop>
</C:addressbook-query>`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("addressbook-multiget REPORT", () => {
	it("fetches both contacts by href and returns address-data", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/card/primary/", multigetBoth, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: [ALICE_UID, BOB_UID],
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("fetches a single contact by href", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/card/primary/", multigetAliceOnly, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: ALICE_UID,
						bodyNotContains: BOB_UID,
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 404 propstat for non-existent href", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/card/primary/", multigetWithMissing, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: ["200", "404"],
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

describe("addressbook-query REPORT", () => {
	it("empty filter returns all contacts", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/card/primary/", queryAll, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: [ALICE_UID, BOB_UID],
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("text-match contains 'Alice' returns only Alice", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/card/primary/", queryFnContainsAlice, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: ALICE_UID,
						bodyNotContains: BOB_UID,
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("negate text-match excludes Alice, returns Bob", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/card/primary/", queryFnNotAlice, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: BOB_UID,
						bodyNotContains: ALICE_UID,
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("starts-with 'Bob' returns only Bob", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/card/primary/", queryFnStartsWithBob, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: BOB_UID,
						bodyNotContains: ALICE_UID,
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("ends-with 'Smith' returns only Alice", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/card/primary/", queryFnEndsWithSmith, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: ALICE_UID,
						bodyNotContains: BOB_UID,
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("equals 'Alice Smith' returns only Alice", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/card/primary/", queryFnEqualsAliceSmith, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: ALICE_UID,
						bodyNotContains: BOB_UID,
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("anyof filter matching either contact returns both", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/card/primary/", queryAnyof, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: [ALICE_UID, BOB_UID],
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("allof filter with mutually exclusive conditions returns empty result", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/card/primary/", queryAllof, {
					as: "test",
					expect: {
						status: 207,
						bodyNotContains: [ALICE_UID, BOB_UID],
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("is-not-defined on FN (always present) returns no results", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/card/primary/", queryFnIsNotDefined, {
					as: "test",
					expect: {
						status: 207,
						bodyNotContains: [ALICE_UID, BOB_UID],
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("missing <C:filter> returns 403 CARDDAV:valid-filter", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/card/primary/", queryMissingFilter, {
					as: "test",
					expect: {
						status: 403,
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// RFC 6352 §10.5.1: prop-filter with is-not-defined on EMAIL (not present in
	// either test vCard) should match both contacts.
	it("is-not-defined on absent property (EMAIL) returns all contacts", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/card/primary/", queryEmailIsNotDefined, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: [ALICE_UID, BOB_UID],
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

describe("addressbook-multiget REPORT — edge cases", () => {
	// RFC 6352 §8.7: a multiget with no <D:href> elements is valid and should
	// return 207 with no resource responses.
	it("multiget with no hrefs returns 207 with empty response set", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/card/primary/", multigetNoHrefs, {
					as: "test",
					expect: {
						status: 207,
						bodyNotContains: [ALICE_UID, BOB_UID],
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// RFC 6352 §8.6.1: <C:address-data> subsetting should return only the
	// requested vCard properties (UID and FN). RFC 6352 §8.5.1 + RFC 6350
	// require VERSION to always be present even when not explicitly requested.
	it("address-data subsetting returns only requested vCard properties", async () => {
		const results = await runScript(
			[
				...SETUP,
				report("/dav/principals/test/card/primary/", multigetAliceSubsetted, {
					as: "test",
					expect: {
						status: 207,
						bodyContains: ["FN", "Alice Smith"],
					},
				}),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		// VERSION must always be present per RFC 6352 §8.5.1 (mandatory vCard property)
		expect(results[2]?.body).toContain("VERSION:4.0");
	});
});
