import { describe, expect, it } from "bun:test";
import { makeCalEvent } from "#src/testing/data.ts";
import {
	get,
	PROPFIND_ALLPROP,
	propfind,
	put,
	singleUser,
	twoUsers,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

// ---------------------------------------------------------------------------
// ACL — RFC 3744
//
// These tests exercise the ACL method end-to-end against the real server stack.
// The unit tests (acl.unit.test.ts) cover handler internals; these verify that
// ACL changes actually affect subsequent access checks.
// ---------------------------------------------------------------------------

const EVENT = makeCalEvent({
	uid: "acl-integration-001@example.com",
	summary: "ACL Integration Event",
	dtstart: "20260115T100000Z",
	dtend: "20260115T110000Z",
});

/** Build a minimal DAV:acl body. */
const makeAclBody = (
	principalHref: string,
	privileges: ReadonlyArray<string>,
) => {
	const privXml = privileges
		.map((p) => `<D:privilege><D:${p}/></D:privilege>`)
		.join("");
	return `<?xml version="1.0" encoding="utf-8"?>
<D:acl xmlns:D="DAV:">
  <D:ace>
    <D:principal><D:href>${principalHref}</D:href></D:principal>
    <D:grant>${privXml}</D:grant>
  </D:ace>
</D:acl>`;
};

const makeAclStep = (
	path: string,
	body: string,
	as: string,
	expectedStatus = 200,
) => ({
	name: `ACL ${path}`,
	method: "ACL" as const,
	path,
	as,
	headers: { "Content-Type": "application/xml; charset=utf-8" },
	body,
	expect: { status: expectedStatus },
});

// ---------------------------------------------------------------------------
// Basic success
// ---------------------------------------------------------------------------

describe("ACL — basic success", () => {
	// RFC 3744 §8.1: ACL method on a collection must succeed when the acting
	// principal holds DAV:write-acl on the resource.
	it("owner can set ACL on their own collection (200)", async () => {
		const results = await runScript(
			[
				makeAclStep(
					"/dav/principals/test/cal/primary/",
					makeAclBody("/dav/principals/test/", ["read"]),
					"test",
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("owner can set ACL on their own principal resource (200)", async () => {
		const results = await runScript(
			[
				makeAclStep(
					"/dav/principals/test/",
					makeAclBody("/dav/principals/test/", ["read"]),
					"test",
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// Authorization guard
// ---------------------------------------------------------------------------

describe("ACL — authorization", () => {
	// Unauthenticated requests must be rejected before the request body is read.
	it("returns 403 when unauthenticated", async () => {
		const results = await runScript(
			[
				{
					name: "ACL unauthenticated",
					method: "ACL" as const,
					path: "/dav/principals/test/cal/primary/",
					// no `as` → unauthenticated
					expect: { status: 403 },
				},
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// A principal without DAV:write-acl cannot modify ACEs on another's resource.
	it("returns 403 DAV:need-privileges when acting user lacks write-acl", async () => {
		const results = await runScript(
			[
				makeAclStep(
					"/dav/principals/bob/cal/primary/",
					makeAclBody("/dav/principals/alice/", ["read"]),
					"alice",
					403,
				),
			],
			twoUsers(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// Server restrictions
// ---------------------------------------------------------------------------

describe("ACL — server restrictions", () => {
	// RFC 3744 §8.1.1: servers that only support grant model must reject deny ACEs.
	it("returns 403 DAV:grant-only for a deny ACE", async () => {
		const denyBody = `<?xml version="1.0" encoding="utf-8"?>
<D:acl xmlns:D="DAV:">
  <D:ace>
    <D:principal><D:all/></D:principal>
    <D:deny><D:privilege><D:read/></D:privilege></D:deny>
  </D:ace>
</D:acl>`;

		const results = await runScript(
			[makeAclStep("/dav/principals/test/cal/primary/", denyBody, "test", 403)],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// RFC 3744 §8.1.1: invert principal type is not supported.
	it("returns 403 DAV:no-invert for an invert principal", async () => {
		const invertBody = `<?xml version="1.0" encoding="utf-8"?>
<D:acl xmlns:D="DAV:">
  <D:ace>
    <D:principal><D:invert><D:all/></D:invert></D:principal>
    <D:grant><D:privilege><D:read/></D:privilege></D:grant>
  </D:ace>
</D:acl>`;

		const results = await runScript(
			[
				makeAclStep(
					"/dav/principals/test/cal/primary/",
					invertBody,
					"test",
					403,
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// Access-control effect
// ---------------------------------------------------------------------------

describe("ACL — access-control effect", () => {
	// After granting DAV:read to alice on bob's collection, alice should be able
	// to PROPFIND that collection.
	it("granting DAV:read to another user enables PROPFIND on that resource", async () => {
		const results = await runScript(
			[
				// Bob grants alice read access on his primary calendar
				makeAclStep(
					"/dav/principals/bob/cal/primary/",
					makeAclBody("/dav/principals/alice/", ["read"]),
					"bob",
				),
				// Alice can now PROPFIND bob's collection
				propfind("/dav/principals/bob/cal/primary/", PROPFIND_ALLPROP, {
					as: "alice",
					headers: { Depth: "0" },
					expect: { status: 207 },
				}),
			],
			twoUsers(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// After granting DAV:write to alice on bob's collection, alice should be able
	// to PUT into it.
	it("granting DAV:write enables PUT into that collection", async () => {
		const results = await runScript(
			[
				makeAclStep(
					"/dav/principals/bob/cal/primary/",
					makeAclBody("/dav/principals/alice/", ["write", "read"]),
					"bob",
				),
				put(
					"/dav/principals/bob/cal/primary/alice-event.ics",
					EVENT,
					"text/calendar; charset=utf-8",
					{ as: "alice", expect: { status: 201 } },
				),
				// Verify alice can also read it back
				get("/dav/principals/bob/cal/primary/alice-event.ics", {
					as: "alice",
					expect: { status: 200 },
				}),
			],
			twoUsers(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// Clearing the ACL (empty body) removes non-protected ACEs, so alice loses access.
	it("clearing ACL revokes previously granted access", async () => {
		const results = await runScript(
			[
				// Grant alice read
				makeAclStep(
					"/dav/principals/bob/cal/primary/",
					makeAclBody("/dav/principals/alice/", ["read"]),
					"bob",
				),
				// Clear all non-protected ACEs
				makeAclStep(
					"/dav/principals/bob/cal/primary/",
					`<?xml version="1.0" encoding="utf-8"?><D:acl xmlns:D="DAV:"/>`,
					"bob",
				),
				// Alice is now denied
				propfind("/dav/principals/bob/cal/primary/", PROPFIND_ALLPROP, {
					as: "alice",
					headers: { Depth: "0" },
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

// ---------------------------------------------------------------------------
// Path gating
// ---------------------------------------------------------------------------

describe("ACL — path gating", () => {
	// ACL on a non-existent resource must return 404 (RFC 3744 §8.1).
	it("returns 404 for a non-existent collection slug", async () => {
		const results = await runScript(
			[
				makeAclStep(
					"/dav/principals/test/cal/no-such-cal/",
					makeAclBody("/dav/principals/test/", ["read"]),
					"test",
					404,
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// ACL on the DAV root must be rejected with 405.
	it("returns 405 for the DAV root path", async () => {
		const results = await runScript(
			[
				makeAclStep(
					"/dav/",
					makeAclBody("/dav/principals/test/", ["read"]),
					"test",
					405,
				),
			],
			singleUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});
