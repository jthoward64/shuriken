import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import { applyReadOnlyPrivileges } from "./read-only-guard.ts";

describe("applyReadOnlyPrivileges", () => {
	it("is a no-op when the collection is writable", () => {
		const privileges: ReadonlyArray<DavPrivilege> = [
			"DAV:read",
			"DAV:write",
			"DAV:write-content",
			"DAV:bind",
			"DAV:unbind",
		];
		expect(applyReadOnlyPrivileges(privileges, false)).toEqual(privileges);
	});

	it("strips content/binding write privileges when read-only", () => {
		const privileges: ReadonlyArray<DavPrivilege> = [
			"DAV:all",
			"DAV:read",
			"DAV:write",
			"DAV:write-properties",
			"DAV:write-content",
			"DAV:bind",
			"DAV:unbind",
		];
		const result = applyReadOnlyPrivileges(privileges, true);
		expect(result).not.toContain("DAV:all");
		expect(result).not.toContain("DAV:write");
		expect(result).not.toContain("DAV:write-content");
		expect(result).not.toContain("DAV:bind");
		expect(result).not.toContain("DAV:unbind");
	});

	it("keeps read and property-write privileges when read-only", () => {
		// write-properties is retained so clients can still rename/recolor a
		// subscription or birthdays calendar (stored as per-user overrides).
		const privileges: ReadonlyArray<DavPrivilege> = [
			"DAV:read",
			"DAV:read-current-user-privilege-set",
			"DAV:read-acl",
			"DAV:write-properties",
			"DAV:write-acl",
			"DAV:write",
		];
		const result = applyReadOnlyPrivileges(privileges, true);
		expect(result).toEqual([
			"DAV:read",
			"DAV:read-current-user-privilege-set",
			"DAV:read-acl",
			"DAV:write-properties",
			"DAV:write-acl",
		]);
	});
});
