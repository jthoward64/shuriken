import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import { AclServiceAllowAll } from "./service.allow-all.ts";
import { AclService } from "./service.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PRINCIPAL = PrincipalId("00000000-0000-0000-0000-000000000001");
const COLLECTION = CollectionId("00000000-0000-0000-0000-000000000002");

// ---------------------------------------------------------------------------
// AclServiceAllowAll
// ---------------------------------------------------------------------------

describe("AclServiceAllowAll", () => {
	it("check returns void for DAV:read", async () => {
		const result = await Effect.runPromise(
			AclService.pipe(
				Effect.flatMap((svc) =>
					svc.check(PRINCIPAL, COLLECTION, "collection", "DAV:read"),
				),
				Effect.provide(AclServiceAllowAll),
			),
		);
		expect(result).toBeUndefined();
	});

	it("check returns void for any other privilege", async () => {
		const result = await Effect.runPromise(
			AclService.pipe(
				Effect.flatMap((svc) =>
					svc.check(PRINCIPAL, COLLECTION, "collection", "DAV:write-acl"),
				),
				Effect.provide(AclServiceAllowAll),
			),
		);
		expect(result).toBeUndefined();
	});

	it("currentUserPrivileges returns all 19 DavPrivilege values", async () => {
		const privs = await Effect.runPromise(
			AclService.pipe(
				Effect.flatMap((svc) =>
					svc.currentUserPrivileges(PRINCIPAL, COLLECTION, "collection"),
				),
				Effect.provide(AclServiceAllowAll),
			),
		);
		expect(privs).toHaveLength(19);
		expect(privs).toContain("DAV:read");
		expect(privs).toContain("DAV:all");
		expect(privs).toContain("CALDAV:schedule-send-freebusy");
	});
});
