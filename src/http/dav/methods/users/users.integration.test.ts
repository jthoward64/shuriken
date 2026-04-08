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
// Users management API — /dav/users/
//
// Tests for userPropfindHandler, userMkcolHandler, userDeleteHandler,
// and userProppatchHandler.
//
// The SHURIKEN_NS is "https://shuriken.jthoward.dev/dav/ns" — used for
// the shuriken:name, shuriken:email, and shuriken:credential properties.
// ---------------------------------------------------------------------------

const SHURIKEN_NS = "https://shuriken.jthoward.dev/dav/ns";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mkuser = (
	slug: string,
	as: string,
	body?: string,
): {
	name: string;
	method: "MKCOL";
	path: string;
	as: string;
	headers: Record<string, string>;
	body: string | undefined;
	expect: { status: number };
} => ({
	name: `MKCOL /dav/users/${slug}/`,
	method: "MKCOL" as const,
	path: `/dav/users/${slug}/`,
	as,
	headers: body ? { "Content-Type": "application/xml; charset=utf-8" } : {},
	body,
	expect: { status: 201 },
});

const mkuserWithProps = (
	_slug: string,
	displayName?: string,
	name?: string,
	email?: string,
) =>
	`<?xml version="1.0" encoding="utf-8"?>
<D:mkcol xmlns:D="DAV:" xmlns:S="${SHURIKEN_NS}">
  <D:set>
    <D:prop>
      ${displayName !== undefined ? `<D:displayname>${displayName}</D:displayname>` : ""}
      ${name !== undefined ? `<S:name>${name}</S:name>` : ""}
      ${email !== undefined ? `<S:email>${email}</S:email>` : ""}
    </D:prop>
  </D:set>
</D:mkcol>`;

const setDisplayname = (name: string) =>
	`<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>${name}</D:displayname>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

const setShurikenName = (name: string) =>
	`<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:S="${SHURIKEN_NS}">
  <D:set>
    <D:prop>
      <S:name>${name}</S:name>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

const setShurikenEmail = (email: string) =>
	`<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:S="${SHURIKEN_NS}">
  <D:set>
    <D:prop>
      <S:email>${email}</S:email>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

const setLocalCredential = (authId: string, password: string) =>
	`<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:S="${SHURIKEN_NS}">
  <D:set>
    <D:prop>
      <S:credential>
        <S:source>local</S:source>
        <S:auth-id>${authId}</S:auth-id>
        <S:password>${password}</S:password>
      </S:credential>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

const setProxyCredential = (authId: string) =>
	`<?xml version="1.0" encoding="utf-8"?>
<D:propertyupdate xmlns:D="DAV:" xmlns:S="${SHURIKEN_NS}">
  <D:set>
    <D:prop>
      <S:credential>
        <S:source>proxy</S:source>
        <S:auth-id>${authId}</S:auth-id>
      </S:credential>
    </D:prop>
  </D:set>
</D:propertyupdate>`;

// ---------------------------------------------------------------------------
// PROPFIND /dav/users/ — collection listing
// ---------------------------------------------------------------------------

describe("PROPFIND /dav/users/ — collection", () => {
	it("Depth:0 returns 207 with 'Users' displayname", async () => {
		const results = await runScript(
			[
				propfind("/dav/users/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 207, bodyContains: "Users" },
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
				propfind("/dav/users/", PROPFIND_ALLPROP, {
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

	it("Depth:1 lists all users", async () => {
		const results = await runScript(
			[
				propfind("/dav/users/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "1" },
					expect: { status: 207, bodyContains: "admin" },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("Depth:1 includes shuriken:email for each user", async () => {
		const results = await runScript(
			[
				propfind("/dav/users/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "1" },
					expect: { status: 207, bodyContains: "admin@example.com" },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 403 when unauthenticated", async () => {
		const results = await runScript(
			[
				propfind("/dav/users/", PROPFIND_ALLPROP, {
					headers: { Depth: "0" },
					expect: { status: 403 },
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
				propfind("/dav/users/", PROPFIND_ALLPROP, {
					as: "regular",
					headers: { Depth: "0" },
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
// PROPFIND /dav/users/:slug — single user
// ---------------------------------------------------------------------------

describe("PROPFIND /dav/users/:slug — single user", () => {
	it("returns 207 with displayname, name, email, and group-membership", async () => {
		const results = await runScript(
			[
				propfind("/dav/users/admin/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: {
						status: 207,
						bodyContains: ["admin@example.com"],
					},
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 404 for a non-existent user slug", async () => {
		const results = await runScript(
			[
				propfind("/dav/users/no-such-user/", PROPFIND_ALLPROP, {
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

	it("returns 403 for unauthenticated access", async () => {
		const results = await runScript(
			[
				propfind("/dav/users/admin/", PROPFIND_ALLPROP, {
					headers: { Depth: "0" },
					expect: { status: 403 },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("user is also accessible to themselves (own resource)", async () => {
		const results = await runScript(
			[
				propfind("/dav/users/regular/", PROPFIND_ALLPROP, {
					as: "regular",
					headers: { Depth: "0" },
					expect: { status: 207 },
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
// MKCOL /dav/users/:slug — create user
// ---------------------------------------------------------------------------

describe("MKCOL /dav/users/:slug", () => {
	it("creates a user and returns 201 with Location header", async () => {
		const results = await runScript(
			[mkuser("new-user", "admin")],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
		expect(results[0]?.headers.location).toContain("/dav/users/new-user/");
	});

	it("creates a user with display name and email from body", async () => {
		const results = await runScript(
			[
				mkuser(
					"named-user",
					"admin",
					mkuserWithProps(
						"named-user",
						"Named User",
						"Named User",
						"named@example.com",
					),
				),
				propfind("/dav/users/named-user/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: {
						status: 207,
						bodyContains: ["Named User", "named@example.com"],
					},
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 405 when the user slug already exists", async () => {
		const results = await runScript(
			[
				mkuser("dup-user", "admin"),
				{
					...mkuser("dup-user", "admin"),
					expect: { status: 405 },
				},
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 403 when unauthenticated", async () => {
		const results = await runScript(
			[
				{
					name: "MKCOL unauthenticated",
					method: "MKCOL" as const,
					path: "/dav/users/sneaky/",
					expect: { status: 403 },
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
					path: "/dav/users/sneaky/",
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
// DELETE /dav/users/:slug — delete user
// ---------------------------------------------------------------------------

describe("DELETE /dav/users/:slug", () => {
	it("deletes a user and returns 204", async () => {
		const results = await runScript(
			[
				mkuser("to-delete", "admin"),
				del("/dav/users/to-delete/", { as: "admin", expect: { status: 204 } }),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("deleted user is no longer accessible via PROPFIND", async () => {
		const results = await runScript(
			[
				mkuser("gone-user", "admin"),
				del("/dav/users/gone-user/", { as: "admin", expect: { status: 204 } }),
				propfind("/dav/users/gone-user/", PROPFIND_ALLPROP, {
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

	it("returns 404 for a non-existent user", async () => {
		const results = await runScript(
			[
				del("/dav/users/no-such-user/", {
					as: "admin",
					expect: { status: 404 },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 403 when unauthenticated", async () => {
		const results = await runScript(
			[
				mkuser("untouched-user", "admin"),
				del("/dav/users/untouched-user/", { expect: { status: 403 } }),
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
				mkuser("another-user", "admin"),
				del("/dav/users/another-user/", {
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

	// A user provisioned via ScriptOptions.users has a credential and can
	// authenticate; they should be allowed to delete themselves via the own-principal
	// ACL fallback (they have DAV:all on their own principal from provisioning).
	it("user can delete themselves", async () => {
		const results = await runScript(
			[
				del("/dav/users/regular/", {
					as: "regular",
					expect: { status: 204 },
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
// PROPPATCH /dav/users/:slug — update user properties
// ---------------------------------------------------------------------------

describe("PROPPATCH /dav/users/:slug", () => {
	it("updates DAV:displayname and returns 204", async () => {
		const results = await runScript(
			[
				proppatch("/dav/users/admin/", setDisplayname("Admin User"), {
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
				proppatch("/dav/users/admin/", setDisplayname("Fancy Name"), {
					as: "admin",
					expect: { status: 204 },
				}),
				propfind("/dav/users/admin/", PROPFIND_DISPLAYNAME, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 207, bodyContains: "Fancy Name" },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("updates shuriken:name and returns 204", async () => {
		const results = await runScript(
			[
				proppatch("/dav/users/admin/", setShurikenName("New Full Name"), {
					as: "admin",
					expect: { status: 204 },
				}),
				propfind("/dav/users/admin/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 207, bodyContains: "New Full Name" },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("updates shuriken:email and returns 204", async () => {
		const results = await runScript(
			[
				proppatch(
					"/dav/users/admin/",
					setShurikenEmail("newadmin@example.com"),
					{
						as: "admin",
						expect: { status: 204 },
					},
				),
				propfind("/dav/users/admin/", PROPFIND_ALLPROP, {
					as: "admin",
					headers: { Depth: "0" },
					expect: { status: 207, bodyContains: "newadmin@example.com" },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("sets a local credential via shuriken:credential", async () => {
		const results = await runScript(
			[
				proppatch(
					"/dav/users/admin/",
					setLocalCredential("admin@example.com", "newpassword"),
					{ as: "admin", expect: { status: 204 } },
				),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("sets a proxy credential via shuriken:credential", async () => {
		const results = await runScript(
			[
				proppatch("/dav/users/admin/", setProxyCredential("admin_proxy_id"), {
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

	it("returns 405 for a non-existent user (newUser kind)", async () => {
		const results = await runScript(
			[
				proppatch("/dav/users/no-such-user/", setDisplayname("Ghost"), {
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

	it("returns 403 when unauthenticated", async () => {
		const results = await runScript(
			[
				proppatch("/dav/users/admin/", setDisplayname("Sneaky"), {
					expect: { status: 403 },
				}),
			],
			singleAdminUser(),
		);
		for (const result of results) {
			expect(result.failures, result.step.name).toEqual([]);
		}
	});

	it("returns 403 for a non-admin user patching another user", async () => {
		const results = await runScript(
			[
				proppatch("/dav/users/admin/", setDisplayname("Pwned"), {
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

	it("user can PROPPATCH their own resource", async () => {
		const results = await runScript(
			[
				proppatch("/dav/users/regular/", setDisplayname("Self Update"), {
					as: "regular",
					expect: { status: 204 },
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
// Method not allowed — wrong method on user paths
// ---------------------------------------------------------------------------

describe("Users API — method not allowed", () => {
	// RFC 4918 §9.1: PROPFIND on a non-existent resource must return 404.
	it("returns 404 for PROPFIND on a non-existent user", async () => {
		const results = await runScript(
			[
				propfind("/dav/users/no-such-user/", PROPFIND_ALLPROP, {
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
});
