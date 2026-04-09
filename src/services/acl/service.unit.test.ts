import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import type { DavError } from "#src/domain/errors.ts";
import { CollectionId, InstanceId, PrincipalId } from "#src/domain/ids.ts";
import { HTTP_FORBIDDEN } from "#src/http/status.ts";
import { runFailure, runSuccess } from "#src/testing/effect.ts";
import { makeTestEnv } from "#src/testing/env.ts";
import { AclService } from "./service.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A fixed UUID representing a collection resource (as stored in dav_acl.resource_id)
const RID = CollectionId("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
const RTYPE = "collection" as const;

// ---------------------------------------------------------------------------
// AclService.check — privilege hierarchy
// ---------------------------------------------------------------------------

describe("AclService.check", () => {
	it("passes when the principal has exactly the required privilege", async () => {
		const principalId = PrincipalId(crypto.randomUUID());
		const env = makeTestEnv().withAce({
			resourceType: RTYPE,
			resourceId: RID,
			principalType: "principal",
			principalId,
			privilege: "DAV:read",
			grantDeny: "grant",
		});
		await runSuccess(
			AclService.pipe(
				Effect.flatMap((s) => s.check(principalId, RID, RTYPE, "DAV:read")),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
	});

	it("passes via container: DAV:write satisfies a DAV:write-content check", async () => {
		// expandContainers("DAV:write-content") → [DAV:write-content, DAV:write, DAV:all]
		// Granting DAV:write means a check for DAV:write-content should pass.
		const principalId = PrincipalId(crypto.randomUUID());
		const env = makeTestEnv().withAce({
			resourceType: RTYPE,
			resourceId: RID,
			principalType: "principal",
			principalId,
			privilege: "DAV:write",
			grantDeny: "grant",
		});
		await runSuccess(
			AclService.pipe(
				Effect.flatMap((s) =>
					s.check(principalId, RID, RTYPE, "DAV:write-content"),
				),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
	});

	it("passes via DAV:all: granting DAV:all satisfies any privilege check", async () => {
		const principalId = PrincipalId(crypto.randomUUID());
		const env = makeTestEnv().withAce({
			resourceType: RTYPE,
			resourceId: RID,
			principalType: "principal",
			principalId,
			privilege: "DAV:all",
			grantDeny: "grant",
		});
		await runSuccess(
			AclService.pipe(
				Effect.flatMap((s) => s.check(principalId, RID, RTYPE, "DAV:read-acl")),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
	});

	it("fails with 403 DAV:need-privileges when no matching ACE exists", async () => {
		const principalId = PrincipalId(crypto.randomUUID());
		const env = makeTestEnv(); // no ACEs
		const err = (await runFailure(
			AclService.pipe(
				Effect.flatMap((s) => s.check(principalId, RID, RTYPE, "DAV:read")),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_FORBIDDEN);
		expect(err.precondition).toBe("DAV:need-privileges");
	});

	it("fails when the principal has a different privilege but not the checked one", async () => {
		const principalId = PrincipalId(crypto.randomUUID());
		// Grant DAV:read-acl — does NOT satisfy a DAV:read check
		const env = makeTestEnv().withAce({
			resourceType: RTYPE,
			resourceId: RID,
			principalType: "principal",
			principalId,
			privilege: "DAV:read-acl",
			grantDeny: "grant",
		});
		const err = (await runFailure(
			AclService.pipe(
				Effect.flatMap((s) => s.check(principalId, RID, RTYPE, "DAV:read")),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;
		expect(err.status).toBe(HTTP_FORBIDDEN);
	});

	it("passes when a group the principal belongs to holds the privilege", async () => {
		const userId = crypto.randomUUID();
		const groupId = crypto.randomUUID();
		const groupPrincipalId = crypto.randomUUID();

		const env = makeTestEnv()
			.withUser({ id: userId })
			.withGroup({ id: groupId, principalId: groupPrincipalId });

		// Access env.stores to get the user's principalId
		const userRow = env.stores.users.get(userId);
		expect(userRow).toBeDefined();
		if (!userRow) {
			throw new Error("User row not found");
		}
		const userPrincipalId = PrincipalId(userRow.principalId);

		// Add user to group
		env.stores.memberships.set(groupId, new Set([userId]));

		// Grant privilege to the group's principal, not the user's
		env.withAce({
			resourceType: RTYPE,
			resourceId: RID,
			principalType: "principal",
			principalId: groupPrincipalId,
			privilege: "DAV:read",
			grantDeny: "grant",
		});

		await runSuccess(
			AclService.pipe(
				Effect.flatMap((s) => s.check(userPrincipalId, RID, RTYPE, "DAV:read")),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
	});

	it("passes for 'all' principal type regardless of caller identity", async () => {
		const principalId = PrincipalId(crypto.randomUUID());
		const env = makeTestEnv().withAce({
			resourceType: RTYPE,
			resourceId: RID,
			principalType: "all",
			privilege: "DAV:read",
			grantDeny: "grant",
		});
		await runSuccess(
			AclService.pipe(
				Effect.flatMap((s) => s.check(principalId, RID, RTYPE, "DAV:read")),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
	});
});

// ---------------------------------------------------------------------------
// AclService.currentUserPrivileges — expandContained
// ---------------------------------------------------------------------------

describe("AclService.currentUserPrivileges", () => {
	it("DAV:read expands to include read-current-user-privilege-set (RFC 3744 §5.4)", async () => {
		const principalId = PrincipalId(crypto.randomUUID());
		const env = makeTestEnv().withAce({
			resourceType: RTYPE,
			resourceId: RID,
			principalType: "principal",
			principalId,
			privilege: "DAV:read",
		});
		const result = await runSuccess(
			AclService.pipe(
				Effect.flatMap((s) => s.currentUserPrivileges(principalId, RID, RTYPE)),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
		expect(result).toContain("DAV:read");
		expect(result).toContain("DAV:read-current-user-privilege-set");
	});

	it("DAV:write expands to include write-properties, write-content, bind, unbind", async () => {
		const principalId = PrincipalId(crypto.randomUUID());
		const env = makeTestEnv().withAce({
			resourceType: RTYPE,
			resourceId: RID,
			principalType: "principal",
			principalId,
			privilege: "DAV:write",
		});
		const result = await runSuccess(
			AclService.pipe(
				Effect.flatMap((s) => s.currentUserPrivileges(principalId, RID, RTYPE)),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
		expect(result).toContain("DAV:write");
		expect(result).toContain("DAV:write-properties");
		expect(result).toContain("DAV:write-content");
		expect(result).toContain("DAV:bind");
		expect(result).toContain("DAV:unbind");
	});

	it("DAV:all expands to the full set of contained privileges", async () => {
		// This list mirrors PRIVILEGE_CONTAINED["DAV:all"] in service.live.ts plus
		// "DAV:all" itself (added by expandContained).  Update this list whenever
		// that constant changes.
		const expectedPrivileges = [
			"DAV:all",
			"DAV:read",
			"DAV:write",
			"DAV:write-properties",
			"DAV:write-content",
			"DAV:bind",
			"DAV:unbind",
			"DAV:unlock",
			"DAV:read-acl",
			"DAV:read-current-user-privilege-set",
			"DAV:write-acl",
			"CALDAV:schedule-deliver",
			"CALDAV:schedule-deliver-invite",
			"CALDAV:schedule-deliver-reply",
			"CALDAV:schedule-query-freebusy",
			"CALDAV:schedule-send",
			"CALDAV:schedule-send-invite",
			"CALDAV:schedule-send-reply",
			"CALDAV:schedule-send-freebusy",
		] as const;

		const principalId = PrincipalId(crypto.randomUUID());
		const env = makeTestEnv().withAce({
			resourceType: RTYPE,
			resourceId: RID,
			principalType: "principal",
			principalId,
			privilege: "DAV:all",
		});
		const result = await runSuccess(
			AclService.pipe(
				Effect.flatMap((s) => s.currentUserPrivileges(principalId, RID, RTYPE)),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
		expect(result).toHaveLength(expectedPrivileges.length);
		for (const p of expectedPrivileges) {
			expect(result).toContain(p);
		}
	});

	it("CALDAV:schedule-deliver expands to invite and reply children", async () => {
		const principalId = PrincipalId(crypto.randomUUID());
		const env = makeTestEnv().withAce({
			resourceType: RTYPE,
			resourceId: RID,
			principalType: "principal",
			principalId,
			privilege: "CALDAV:schedule-deliver",
		});
		const result = await runSuccess(
			AclService.pipe(
				Effect.flatMap((s) => s.currentUserPrivileges(principalId, RID, RTYPE)),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
		expect(result).toContain("CALDAV:schedule-deliver");
		expect(result).toContain("CALDAV:schedule-deliver-invite");
		expect(result).toContain("CALDAV:schedule-deliver-reply");
	});

	it("returns empty array when no ACEs exist for the resource", async () => {
		const principalId = PrincipalId(crypto.randomUUID());
		const env = makeTestEnv();
		const result = await runSuccess(
			AclService.pipe(
				Effect.flatMap((s) => s.currentUserPrivileges(principalId, RID, RTYPE)),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
		expect(Array.isArray(result)).toBe(true);
		expect(result).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// AclService.check — inheritance (Fix 12)
// ---------------------------------------------------------------------------

describe("AclService.check — inheritance", () => {
	it("passes on an instance when the parent collection has the required privilege", async () => {
		const principalId = PrincipalId(crypto.randomUUID());
		const collectionId = CollectionId(crypto.randomUUID());
		const instanceId = InstanceId(crypto.randomUUID());

		const env = makeTestEnv();
		env.withUser({ principalId });
		env.withCollection({ id: collectionId, ownerPrincipalId: principalId });
		env.withInstance({ id: instanceId, collectionId });
		env.withAce({
			resourceType: "collection",
			resourceId: collectionId,
			principalType: "principal",
			principalId,
			privilege: "DAV:read",
			grantDeny: "grant",
		});

		await runSuccess(
			AclService.pipe(
				Effect.flatMap((s) =>
					s.check(principalId, instanceId, "instance", "DAV:read"),
				),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
	});

	it("passes on a collection when the owner principal has DAV:all", async () => {
		const principalId = PrincipalId(crypto.randomUUID());
		const collectionId = CollectionId(crypto.randomUUID());

		const env = makeTestEnv();
		env.withUser({ principalId });
		env.withCollection({ id: collectionId, ownerPrincipalId: principalId });
		// No direct ACE on the collection — only on the principal
		env.withAce({
			resourceType: "principal",
			resourceId: principalId,
			principalType: "principal",
			principalId,
			privilege: "DAV:all",
			grantDeny: "grant",
		});

		await runSuccess(
			AclService.pipe(
				Effect.flatMap((s) =>
					s.check(principalId, collectionId, "collection", "DAV:write-content"),
				),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
	});

	it("fails with 403 when no ACE exists on the instance or any ancestor", async () => {
		const principalId = PrincipalId(crypto.randomUUID());
		const collectionId = CollectionId(crypto.randomUUID());
		const instanceId = InstanceId(crypto.randomUUID());

		const env = makeTestEnv();
		env.withUser({ principalId });
		env.withCollection({ id: collectionId, ownerPrincipalId: principalId });
		env.withInstance({ id: instanceId, collectionId });
		// No ACEs anywhere

		const err = (await runFailure(
			AclService.pipe(
				Effect.flatMap((s) =>
					s.check(principalId, instanceId, "instance", "DAV:read"),
				),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_FORBIDDEN);
	});

	it("fails when the collection ACE covers a different privilege only", async () => {
		const principalId = PrincipalId(crypto.randomUUID());
		const collectionId = CollectionId(crypto.randomUUID());
		const instanceId = InstanceId(crypto.randomUUID());

		const env = makeTestEnv();
		env.withUser({ principalId });
		env.withCollection({ id: collectionId, ownerPrincipalId: principalId });
		env.withInstance({ id: instanceId, collectionId });
		// Collection only grants DAV:read-acl — not enough for DAV:write-content
		env.withAce({
			resourceType: "collection",
			resourceId: collectionId,
			principalType: "principal",
			principalId,
			privilege: "DAV:read-acl",
			grantDeny: "grant",
		});

		const err = (await runFailure(
			AclService.pipe(
				Effect.flatMap((s) =>
					s.check(principalId, instanceId, "instance", "DAV:write-content"),
				),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err.status).toBe(HTTP_FORBIDDEN);
	});
});

// ---------------------------------------------------------------------------
// AclService.currentUserPrivileges — inheritance (Fix 12)
// ---------------------------------------------------------------------------

describe("AclService.currentUserPrivileges — inheritance", () => {
	it("returns privileges from parent collection when instance has no direct ACEs", async () => {
		const principalId = PrincipalId(crypto.randomUUID());
		const collectionId = CollectionId(crypto.randomUUID());
		const instanceId = InstanceId(crypto.randomUUID());

		const env = makeTestEnv();
		env.withUser({ principalId });
		env.withCollection({ id: collectionId, ownerPrincipalId: principalId });
		env.withInstance({ id: instanceId, collectionId });
		env.withAce({
			resourceType: "collection",
			resourceId: collectionId,
			principalType: "principal",
			principalId,
			privilege: "DAV:read",
			grantDeny: "grant",
		});

		const result = await runSuccess(
			AclService.pipe(
				Effect.flatMap((s) =>
					s.currentUserPrivileges(principalId, instanceId, "instance"),
				),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result).toContain("DAV:read");
	});

	it("merges direct and inherited privileges", async () => {
		const principalId = PrincipalId(crypto.randomUUID());
		const collectionId = CollectionId(crypto.randomUUID());
		const instanceId = InstanceId(crypto.randomUUID());

		const env = makeTestEnv();
		env.withUser({ principalId });
		env.withCollection({ id: collectionId, ownerPrincipalId: principalId });
		env.withInstance({ id: instanceId, collectionId });
		// Direct ACE on instance: DAV:read
		env.withAce({
			resourceType: "instance",
			resourceId: instanceId,
			principalType: "principal",
			principalId,
			privilege: "DAV:read",
			grantDeny: "grant",
		});
		// Inherited from collection: DAV:write-content
		env.withAce({
			resourceType: "collection",
			resourceId: collectionId,
			principalType: "principal",
			principalId,
			privilege: "DAV:write-content",
			grantDeny: "grant",
		});

		const result = await runSuccess(
			AclService.pipe(
				Effect.flatMap((s) =>
					s.currentUserPrivileges(principalId, instanceId, "instance"),
				),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result).toContain("DAV:read");
		expect(result).toContain("DAV:write-content");
	});
});
