import { describe, expect, it } from "bun:test";
import {
	del,
	makeAdminUser,
	makeUser,
	PROPFIND_ALLPROP,
	PROPFIND_DISPLAYNAME,
	propfind,
	proppatch,
	singleAdminUser,
} from "#src/testing/script-runner/fixtures.ts";
import { runScript } from "#src/testing/script-runner/runner.ts";

// ---------------------------------------------------------------------------
// Groups management API — /dav/groups/
//
// Tests for groupPropfindHandler, groupMkcolHandler, groupDeleteHandler,
// groupMemberPutHandler, groupMemberDeleteHandler, groupProppatchHandler.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mkgroup = (slug: string, as: string, body?: string) => ({
	name: `MKCOL /dav/groups/${slug}/`,
	method: "MKCOL" as const,
	path: `/dav/groups/${slug}/`,
	as,
	headers: body
		? { "Content-Type": "application/xml; charset=utf-8" }
		: undefined,
	body,
	expect: { status: 201 },
});

const putMember = (groupSlug: string, userSlug: string, as: string) => ({
	name: `PUT /dav/groups/${groupSlug}/members/${userSlug}`,
	method: "PUT" as const,
	path: `/dav/groups/${groupSlug}/members/${userSlug}`,
	as,
	expect: { status: 204 },
});

const delMember = (groupSlug: string, userSlug: string, as: string) => ({
	name: `DELETE /dav/groups/${groupSlug}/members/${userSlug}`,
	method: "DELETE" as const,
	path: `/dav/groups/${groupSlug}/members/${userSlug}`,
	as,
	expect: { status: 204 },
});

const setDisplayname = (name: string) =>
	`<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>${name}</D:displayname>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

const setGroupMemberSet = (...hrefs: Array<string>) =>
	`<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:group-member-set>
        ${hrefs.map((h) => `<D:href>${h}</D:href>`).join("\n        ")}
      </D:group-member-set>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

const clearGroupMemberSet = `<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:group-member-set/>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

const mkgroupWithName = (_slug: string, displayName: string) =>
	`<?xml version="1.0" encoding="utf-8"?>
<D:mkcol xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>${displayName}</D:displayname>
    </D:prop>
  </D:set>
</D:mkcol>`;

// ---------------------------------------------------------------------------
// PROPFIND /dav/groups/ — collection listing
// ---------------------------------------------------------------------------

describe("PROPFIND /dav/groups/ — collection", () => {
	it("Depth:0 returns 207 with 'Groups' displayname", async () => {
		const results = await runScript(
			[
				propfind("/dav/groups/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 207, bodyContains: "Groups" },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("Depth:0 includes DAV:collection resourcetype", async () => {
		const results = await runScript(
			[
				propfind("/dav/groups/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 207, bodyContains: "collection" },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("Depth:1 lists all groups after creating one", async () => {
		const results = await runScript(
			[
				mkgroup("eng", "admin"),
				propfind("/dav/groups/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "1" },
					expect: { status: 207, bodyContains: "eng" },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("Depth:1 with no groups returns only the collection entry", async () => {
		const results = await runScript(
			[
				propfind("/dav/groups/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "1" },
					expect: { status: 207, bodyContains: "Groups" },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 401 when unauthenticated", async () => {
		const results = await runScript(
			[
				propfind("/dav/groups/", PROPFIND_ALLPROP, {
					// no `as` → unauthenticated
					headers: { Depth: "0" },
					expect: { status: 401 },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 403 for a regular (non-admin) user", async () => {
		const results = await runScript(
			[
				propfind("/dav/groups/", PROPFIND_ALLPROP, {
					as: "regular",
					headers: { Depth: "0" },
					expect: { status: 403 },
				}),
			],
			{
				users: [makeAdminUser("admin"), makeUser("regular")],
			},
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// PROPFIND /dav/groups/:slug — single group
// ---------------------------------------------------------------------------

describe("PROPFIND /dav/groups/:slug — single group", () => {
	it("returns 207 with group displayname and group-member-set", async () => {
		const results = await runScript(
			[
				mkgroup("devs", "admin", mkgroupWithName("devs", "Developers")),
				propfind("/dav/groups/devs/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 207, bodyContains: "Developers" },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 404 for a non-existent group slug", async () => {
		const results = await runScript(
			[
				propfind("/dav/groups/no-such-group/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 404 },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("includes group-member-set hrefs for members", async () => {
		const results = await runScript(
			[
				mkgroup("alpha", "admin"),
				putMember("alpha", "admin", "admin"),
				propfind("/dav/groups/alpha/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 207, bodyContains: "/dav/users/admin/" },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 401 for unauthenticated access", async () => {
		const results = await runScript(
			[
				mkgroup("secret", "admin"),
				propfind("/dav/groups/secret/", PROPFIND_ALLPROP, {
					// no `as`
					headers: { Depth: "0" },
					expect: { status: 401 },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// PROPFIND /dav/groups/:slug/members/ — member listing
// ---------------------------------------------------------------------------

describe("PROPFIND /dav/groups/:slug/members/", () => {
	it("returns 207 with member user properties", async () => {
		const results = await runScript(
			[
				mkgroup("beta", "admin"),
				putMember("beta", "admin", "admin"),
				propfind("/dav/groups/beta/members/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 207, bodyContains: "admin" },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 207 with empty body when group has no members", async () => {
		const results = await runScript(
			[
				mkgroup("empty-group", "admin"),
				propfind("/dav/groups/empty-group/members/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 207 },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 401 for unauthenticated access", async () => {
		const results = await runScript(
			[
				mkgroup("gamma", "admin"),
				propfind("/dav/groups/gamma/members/", PROPFIND_ALLPROP, {
					headers: { Depth: "0" },
					expect: { status: 401 },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// MKCOL /dav/groups/:slug — create group
// ---------------------------------------------------------------------------

describe("MKCOL /dav/groups/:slug", () => {
	it("creates a group and returns 201 with Location header", async () => {
		const results = await runScript(
			[mkgroup("new-group", "admin")],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		expect(results[0]?.headers.location).toContain("/dav/groups/new-group/");
	});

	it("creates a group with displayname from body", async () => {
		const results = await runScript(
			[
				mkgroup(
					"named-group",
					"admin",
					mkgroupWithName("named-group", "My Group"),
				),
				propfind("/dav/groups/named-group/", PROPFIND_DISPLAYNAME, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 207, bodyContains: "My Group" },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 405 when the group already exists", async () => {
		const results = await runScript(
			[
				mkgroup("existing", "admin"),
				{
					...mkgroup("existing", "admin"),
					expect: { status: 405 },
				},
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 401 when unauthenticated", async () => {
		const results = await runScript(
			[
				{
					name: "MKCOL unauthenticated",
					method: "MKCOL" as const,
					path: "/dav/groups/sneaky/",
					expect: { status: 401 },
				},
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 403 for a non-admin user", async () => {
		const results = await runScript(
			[
				{
					name: "MKCOL non-admin",
					method: "MKCOL" as const,
					path: "/dav/groups/sneaky/",
					as: "regular",
					expect: { status: 403 },
				},
			],
			{ users: [makeAdminUser("admin"), makeUser("regular")] },
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// DELETE /dav/groups/:slug — delete group
// ---------------------------------------------------------------------------

describe("DELETE /dav/groups/:slug", () => {
	it("deletes a group and returns 204", async () => {
		const results = await runScript(
			[
				mkgroup("to-delete", "admin"),
				del("/dav/groups/to-delete/", { as: "admin", expect: { status: 204 } }),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("deleted group is no longer accessible via PROPFIND", async () => {
		const results = await runScript(
			[
				mkgroup("gone", "admin"),
				del("/dav/groups/gone/", { as: "admin", expect: { status: 204 } }),
				propfind("/dav/groups/gone/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 404 },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// RFC 4918 §9.6: DELETE on a non-existent resource must return 404.
	it("returns 404 for a non-existent group", async () => {
		const results = await runScript(
			[del("/dav/groups/no-such/", { as: "admin", expect: { status: 404 } })],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 401 when unauthenticated", async () => {
		const results = await runScript(
			[
				mkgroup("untouched", "admin"),
				del("/dav/groups/untouched/", { expect: { status: 401 } }),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 403 for a non-admin user", async () => {
		const results = await runScript(
			[
				mkgroup("protected", "admin"),
				del("/dav/groups/protected/", {
					as: "regular",
					expect: { status: 403 },
				}),
			],
			{ users: [makeAdminUser("admin"), makeUser("regular")] },
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// PUT /dav/groups/:slug/members/:userSlug — add member
// ---------------------------------------------------------------------------

describe("PUT /dav/groups/:slug/members/:userSlug", () => {
	it("adds a member and returns 204", async () => {
		const results = await runScript(
			[mkgroup("team", "admin"), putMember("team", "admin", "admin")],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("added member appears in group-member-set", async () => {
		const results = await runScript(
			[
				mkgroup("project", "admin"),
				putMember("project", "admin", "admin"),
				propfind("/dav/groups/project/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 207, bodyContains: "/dav/users/admin/" },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("adding a member twice is idempotent (204)", async () => {
		const results = await runScript(
			[
				mkgroup("idempotent", "admin"),
				putMember("idempotent", "admin", "admin"),
				putMember("idempotent", "admin", "admin"),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	// RFC 3744 §3: a DAV:principal href must reference a known principal;
	// referencing a non-existent user slug should return 404.
	it("returns 404 for a non-existent user slug", async () => {
		const results = await runScript(
			[
				mkgroup("g1", "admin"),
				{
					name: "PUT non-existent member",
					method: "PUT" as const,
					path: "/dav/groups/g1/members/ghost-user",
					as: "admin",
					expect: { status: 404 },
				},
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 401 when unauthenticated", async () => {
		const results = await runScript(
			[
				mkgroup("g2", "admin"),
				{
					name: "PUT member unauthenticated",
					method: "PUT" as const,
					path: "/dav/groups/g2/members/admin",
					expect: { status: 401 },
				},
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 403 for a non-admin user", async () => {
		const results = await runScript(
			[
				mkgroup("g3", "admin"),
				{
					name: "PUT member non-admin",
					method: "PUT" as const,
					path: "/dav/groups/g3/members/regular",
					as: "regular",
					expect: { status: 403 },
				},
			],
			{ users: [makeAdminUser("admin"), makeUser("regular")] },
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// DELETE /dav/groups/:slug/members/:userSlug — remove member
// ---------------------------------------------------------------------------

describe("DELETE /dav/groups/:slug/members/:userSlug", () => {
	it("removes a member and returns 204", async () => {
		const results = await runScript(
			[
				mkgroup("removable", "admin"),
				putMember("removable", "admin", "admin"),
				delMember("removable", "admin", "admin"),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("removed member no longer appears in group-member-set", async () => {
		const results = await runScript(
			[
				mkgroup("shrinking", "admin"),
				putMember("shrinking", "admin", "admin"),
				delMember("shrinking", "admin", "admin"),
				propfind("/dav/groups/shrinking/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: {
						status: 207,
						bodyNotContains: "/dav/users/admin/",
					},
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 401 when unauthenticated", async () => {
		const results = await runScript(
			[
				mkgroup("g4", "admin"),
				putMember("g4", "admin", "admin"),
				{
					name: "DELETE member unauthenticated",
					method: "DELETE" as const,
					path: "/dav/groups/g4/members/admin",
					expect: { status: 401 },
				},
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 403 for a non-admin user", async () => {
		const results = await runScript(
			[
				mkgroup("g5", "admin"),
				putMember("g5", "admin", "admin"),
				{
					name: "DELETE member non-admin",
					method: "DELETE" as const,
					path: "/dav/groups/g5/members/admin",
					as: "regular",
					expect: { status: 403 },
				},
			],
			{ users: [makeAdminUser("admin"), makeUser("regular")] },
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// PROPPATCH /dav/groups/:slug — update group properties
// ---------------------------------------------------------------------------

describe("PROPPATCH /dav/groups/:slug", () => {
	it("updates DAV:displayname and returns 204", async () => {
		const results = await runScript(
			[
				mkgroup("renameable", "admin"),
				proppatch("/dav/groups/renameable/", setDisplayname("Renamed Group"), {
					as: "admin",
					expect: { status: 204 },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("updated displayname is visible in PROPFIND", async () => {
		const results = await runScript(
			[
				mkgroup("updatable", "admin"),
				proppatch("/dav/groups/updatable/", setDisplayname("Updated Name"), {
					as: "admin",
					expect: { status: 204 },
				}),
				propfind("/dav/groups/updatable/", PROPFIND_DISPLAYNAME, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 207, bodyContains: "Updated Name" },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("sets group-member-set via PROPPATCH", async () => {
		const results = await runScript(
			[
				mkgroup("membership-group", "admin"),
				proppatch(
					"/dav/groups/membership-group/",
					setGroupMemberSet("/dav/users/admin/"),
					{ as: "admin", expect: { status: 204 } },
				),
				propfind("/dav/groups/membership-group/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 207, bodyContains: "/dav/users/admin/" },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("clears group-member-set when set to empty", async () => {
		const results = await runScript(
			[
				mkgroup("emptied", "admin"),
				putMember("emptied", "admin", "admin"),
				proppatch("/dav/groups/emptied/", clearGroupMemberSet, {
					as: "admin",
					expect: { status: 204 },
				}),
				propfind("/dav/groups/emptied/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 207, bodyNotContains: "/dav/users/admin/" },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("replaces membership list atomically via group-member-set", async () => {
		const results = await runScript(
			[
				mkgroup("swap-group", "admin"),
				putMember("swap-group", "alice", "admin"),
				// Replace alice with bob via PROPPATCH group-member-set
				proppatch(
					"/dav/groups/swap-group/",
					setGroupMemberSet("/dav/users/bob/"),
					{ as: "admin", expect: { status: 204 } },
				),
				propfind("/dav/groups/swap-group/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: {
						status: 207,
						bodyContains: "/dav/users/bob/",
						bodyNotContains: "/dav/users/alice/",
					},
				}),
			],
			{
				users: [makeAdminUser("admin"), makeUser("alice"), makeUser("bob")],
			},
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 405 for non-existent group (newGroup kind)", async () => {
		const results = await runScript(
			[
				proppatch("/dav/groups/no-such/", setDisplayname("Ghost"), {
					as: "admin",
					expect: { status: 405 },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 401 when unauthenticated", async () => {
		const results = await runScript(
			[
				mkgroup("patch-target", "admin"),
				proppatch("/dav/groups/patch-target/", setDisplayname("Sneaky"), {
					expect: { status: 401 },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 403 for a non-admin user", async () => {
		const results = await runScript(
			[
				mkgroup("admin-only", "admin"),
				proppatch("/dav/groups/admin-only/", setDisplayname("Sneaky"), {
					as: "regular",
					expect: { status: 403 },
				}),
			],
			{ users: [makeAdminUser("admin"), makeUser("regular")] },
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// Method not allowed — wrong method on group paths
// ---------------------------------------------------------------------------

describe("Groups API — method not allowed", () => {
	it("returns 405 for PROPFIND on a groupMember path", async () => {
		const results = await runScript(
			[
				mkgroup("ma-group", "admin"),
				putMember("ma-group", "admin", "admin"),
				propfind("/dav/groups/ma-group/members/admin", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 405 },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});

// ---------------------------------------------------------------------------
// Group ACL inheritance — members inherit via group principal
// ---------------------------------------------------------------------------

describe("Groups — ACL inheritance via group membership", () => {
	// When alice is a member of a group that has DAV:read on bob's collection,
	// alice should be able to PROPFIND that collection.
	it("group member inherits read access via group membership", async () => {
		const results = await runScript(
			[
				// Admin creates a group and adds alice
				mkgroup("readers", "admin"),
				putMember("readers", "alice", "admin"),
				// Bob grants the readers group read on his primary calendar
				{
					name: "ACL grant to readers group",
					method: "ACL" as const,
					path: "/dav/principals/bob/cal/primary/",
					as: "bob",
					headers: { "Content-Type": "application/xml; charset=utf-8" },
					body: `<?xml version="1.0" encoding="utf-8"?>
<D:acl xmlns:D="DAV:">
  <D:ace>
    <D:principal><D:href>/dav/groups/readers/</D:href></D:principal>
    <D:grant><D:privilege><D:read/></D:privilege></D:grant>
  </D:ace>
</D:acl>`,
					expect: { status: 200 },
				},
				// Alice (group member) can now PROPFIND bob's calendar
				propfind("/dav/principals/bob/cal/primary/", PROPFIND_ALLPROP, {
					as: "alice",
					headers: { Depth: "0" },
					expect: { status: 207 },
				}),
			],
			{
				users: [makeAdminUser("admin"), makeUser("alice"), makeUser("bob")],
			},
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});
});
