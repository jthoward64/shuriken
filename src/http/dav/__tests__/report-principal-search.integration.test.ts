import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { report, twoUsers } from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

// ---------------------------------------------------------------------------
// DAV:principal-property-search REPORT — RFC 3744 §9.4
//
// A name-filtered search returns matching principals. A criteria-less query —
// the "list all principals" idiom python-caldav's search_principals() emits
// with no name — must enumerate every principal (regression: shuriken used to
// return an empty multistatus, reported as principal-search.list-all
// "unsupported"). See documentation/planning/finding-uuid-shaped-slug.md.
// ---------------------------------------------------------------------------

const LIST_ALL = `<?xml version="1.0" encoding="utf-8"?>
<D:principal-property-search xmlns:D="DAV:">
  <D:prop><D:displayname/></D:prop>
</D:principal-property-search>`;

const SEARCH_ALICE = `<?xml version="1.0" encoding="utf-8"?>
<D:principal-property-search xmlns:D="DAV:">
  <D:property-search>
    <D:prop><D:displayname/></D:prop>
    <D:match>alice</D:match>
  </D:property-search>
  <D:prop><D:displayname/></D:prop>
</D:principal-property-search>`;

describe("principal-property-search REPORT (RFC 3744 §9.4)", () => {
	it("enumerates all principals for a criteria-less (list-all) query", async () => {
		const results = await runScript(
			[
				report("/dav/principals/", LIST_ALL, {
					as: "alice",
					expect: { status: 207, bodyContains: ["alice", "bob"] },
				}),
			],
			twoUsers(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns only matching principals for a name-filtered search", async () => {
		const results = await runScript(
			[
				report("/dav/principals/", SEARCH_ALICE, {
					as: "alice",
					expect: {
						status: 207,
						bodyContains: ["alice"],
						bodyNotContains: ["bob"],
					},
				}),
			],
			twoUsers(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});
