import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, ManagedRuntime } from "effect";
import { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import { AclServiceAllowAll } from "./service.allow-all.ts";
import { AclService } from "./service.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const PRINCIPAL = PrincipalId("00000000-0000-0000-0000-000000000001");
const COLLECTION = CollectionId("00000000-0000-0000-0000-000000000002");

// The permissive layer is stateless, so one runtime serves every case
const runtime = ManagedRuntime.make(AclServiceAllowAll);

// ---------------------------------------------------------------------------
// AclServiceAllowAll
// ---------------------------------------------------------------------------

describe("AclServiceAllowAll", () => {
	it("check returns void for DAV:read", async () => {
		const result = await runtime.runPromise(
			AclService.pipe(
				Effect.flatMap((svc) =>
					svc.check(PRINCIPAL, COLLECTION, "collection", "DAV:read"),
				),
			),
		);
		expect(result).toBeUndefined();
	});

	it("check returns void for any other privilege", async () => {
		const result = await runtime.runPromise(
			AclService.pipe(
				Effect.flatMap((svc) =>
					svc.check(PRINCIPAL, COLLECTION, "collection", "DAV:write-acl"),
				),
			),
		);
		expect(result).toBeUndefined();
	});

	it("currentUserPrivileges returns all 19 DavPrivilege values", async () => {
		const privs = await runtime.runPromise(
			AclService.pipe(
				Effect.flatMap((svc) =>
					svc.currentUserPrivileges(PRINCIPAL, COLLECTION, "collection"),
				),
			),
		);
		expect(privs).toHaveLength(19);
		expect(privs).toContain("DAV:read");
		expect(privs).toContain("DAV:all");
		expect(privs).toContain("CALDAV:schedule-send-freebusy");
	});
});
