import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import type { DavError } from "#src/domain/errors.ts";
import { GroupId, UserId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { HTTP_NOT_FOUND } from "#src/http/status.ts";
import { runFailure, runSuccess } from "#src/testing/effect.ts";
import { makeTestEnv } from "#src/testing/env.ts";
import { GroupService } from "./service.ts";

// ---------------------------------------------------------------------------
// GroupService.create
// ---------------------------------------------------------------------------

describe("GroupService.create", () => {
	it("creates a group and returns principal with principalType 'group'", async () => {
		const env = makeTestEnv();

		const result = await runSuccess(
			GroupService.pipe(
				Effect.flatMap((s) => s.create({ slug: Slug("admins") })),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result.principal.principalType).toBe("group");
		expect(result.principal.slug).toBe("admins");
		expect(env.stores.groups.size).toBe(1);
	});

	it("stores an optional displayName on the principal", async () => {
		const env = makeTestEnv();

		const result = await runSuccess(
			GroupService.pipe(
				Effect.flatMap((s) =>
					s.create({ slug: Slug("editors"), displayName: "Editors" }),
				),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result.principal.displayName).toBe("Editors");
	});
});

// ---------------------------------------------------------------------------
// GroupService.update
// ---------------------------------------------------------------------------

describe("GroupService.update", () => {
	it("updates the displayName of an existing group", async () => {
		const env = makeTestEnv();
		const groupId = crypto.randomUUID();
		env.withGroup({ id: groupId, displayName: "Old Name" });

		const result = await runSuccess(
			GroupService.pipe(
				Effect.flatMap((s) =>
					s.update(GroupId(groupId), { displayName: "New Name" }),
				),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result.principal.displayName).toBe("New Name");
	});

	it("fails with 404 when the group does not exist", async () => {
		const env = makeTestEnv();

		const err = (await runFailure(
			GroupService.pipe(
				Effect.flatMap((s) =>
					s.update(GroupId(crypto.randomUUID()), { displayName: "X" }),
				),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// GroupService.addMember
// ---------------------------------------------------------------------------

describe("GroupService.addMember", () => {
	it("adds a user to an existing group (visible in stores.memberships)", async () => {
		const env = makeTestEnv();
		const groupId = crypto.randomUUID();
		const userId = crypto.randomUUID();
		env.withGroup({ id: groupId }).withUser({ id: userId });

		await runSuccess(
			GroupService.pipe(
				Effect.flatMap((s) => s.addMember(GroupId(groupId), UserId(userId))),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(env.stores.memberships.get(groupId)?.has(userId)).toBe(true);
	});

	it("fails with 404 when the group does not exist", async () => {
		const env = makeTestEnv();

		const err = (await runFailure(
			GroupService.pipe(
				Effect.flatMap((s) =>
					s.addMember(
						GroupId(crypto.randomUUID()),
						UserId(crypto.randomUUID()),
					),
				),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// GroupService.removeMember
// ---------------------------------------------------------------------------

describe("GroupService.removeMember", () => {
	it("removes a previously added member from the group", async () => {
		const env = makeTestEnv();
		const groupId = crypto.randomUUID();
		const userId = crypto.randomUUID();
		env.withGroup({ id: groupId }).withUser({ id: userId });
		env.stores.memberships.set(groupId, new Set([userId]));

		await runSuccess(
			GroupService.pipe(
				Effect.flatMap((s) => s.removeMember(GroupId(groupId), UserId(userId))),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(env.stores.memberships.get(groupId)?.has(userId)).toBe(false);
	});

	it("fails with 404 when the group does not exist", async () => {
		const env = makeTestEnv();

		const err = (await runFailure(
			GroupService.pipe(
				Effect.flatMap((s) =>
					s.removeMember(
						GroupId(crypto.randomUUID()),
						UserId(crypto.randomUUID()),
					),
				),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// GroupService.findById
// ---------------------------------------------------------------------------

describe("GroupService.findById", () => {
	it("returns the group when it exists", async () => {
		const env = makeTestEnv();
		const groupId = crypto.randomUUID();
		env.withGroup({ id: groupId, displayName: "Found Group" });

		const result = await runSuccess(
			GroupService.pipe(
				Effect.flatMap((s) => s.findById(GroupId(groupId))),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		// result.group.id is the groupId; result.principal.id is the principalId (different)
		expect(result.group.id).toBe(groupId);
		expect(result.principal.displayName).toBe("Found Group");
	});

	it("fails with 404 when the group does not exist", async () => {
		const env = makeTestEnv();

		const err = (await runFailure(
			GroupService.pipe(
				Effect.flatMap((s) => s.findById(GroupId(crypto.randomUUID()))),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// GroupService.list
// ---------------------------------------------------------------------------

describe("GroupService.list", () => {
	it("returns an empty array when no groups exist", async () => {
		const env = makeTestEnv();

		const result = await runSuccess(
			GroupService.pipe(
				Effect.flatMap((s) => s.list()),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result).toEqual([]);
	});

	it("returns all created groups", async () => {
		const env = makeTestEnv();
		env.withGroup({ id: crypto.randomUUID(), displayName: "Alpha" });
		env.withGroup({ id: crypto.randomUUID(), displayName: "Beta" });

		const result = await runSuccess(
			GroupService.pipe(
				Effect.flatMap((s) => s.list()),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// GroupService.listMembers
// ---------------------------------------------------------------------------

describe("GroupService.listMembers", () => {
	it("returns members of an existing group", async () => {
		const env = makeTestEnv();
		const groupId = crypto.randomUUID();
		const userId = crypto.randomUUID();
		env.withGroup({ id: groupId }).withUser({ id: userId });
		env.stores.memberships.set(groupId, new Set([userId]));

		const result = await runSuccess(
			GroupService.pipe(
				Effect.flatMap((s) => s.listMembers(GroupId(groupId))),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result.length).toBeGreaterThan(0);
	});

	it("returns empty array when group has no members", async () => {
		const env = makeTestEnv();
		const groupId = crypto.randomUUID();
		env.withGroup({ id: groupId });

		const result = await runSuccess(
			GroupService.pipe(
				Effect.flatMap((s) => s.listMembers(GroupId(groupId))),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result).toEqual([]);
	});

	it("fails with 404 when the group does not exist", async () => {
		const env = makeTestEnv();

		const err = (await runFailure(
			GroupService.pipe(
				Effect.flatMap((s) => s.listMembers(GroupId(crypto.randomUUID()))),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// GroupService.listByMember
// ---------------------------------------------------------------------------

describe("GroupService.listByMember", () => {
	it("returns groups that a user belongs to", async () => {
		const env = makeTestEnv();
		const groupId = crypto.randomUUID();
		const userId = crypto.randomUUID();
		env.withGroup({ id: groupId }).withUser({ id: userId });
		env.stores.memberships.set(groupId, new Set([userId]));

		const result = await runSuccess(
			GroupService.pipe(
				Effect.flatMap((s) => s.listByMember(UserId(userId))),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result.length).toBeGreaterThan(0);
	});

	it("returns empty array when user is not in any group", async () => {
		const env = makeTestEnv();
		const userId = crypto.randomUUID();
		env.withUser({ id: userId });

		const result = await runSuccess(
			GroupService.pipe(
				Effect.flatMap((s) => s.listByMember(UserId(userId))),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(result).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// GroupService.delete
// ---------------------------------------------------------------------------

describe("GroupService.delete", () => {
	it("deletes an existing group", async () => {
		const env = makeTestEnv();
		const groupId = crypto.randomUUID();
		env.withGroup({ id: groupId });

		await runSuccess(
			GroupService.pipe(
				Effect.flatMap((s) => s.delete(GroupId(groupId))),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		// softDelete sets deletedAt on the principal (in groupPrincipals), not on the group row
		const groupRow = env.stores.groups.get(groupId);
		expect(groupRow).toBeDefined();
		const principal = groupRow
			? env.stores.groupPrincipals.get(groupRow.principalId)
			: undefined;
		expect(principal?.deletedAt).toBeDefined();
	});

	it("fails with 404 when the group does not exist", async () => {
		const env = makeTestEnv();

		const err = (await runFailure(
			GroupService.pipe(
				Effect.flatMap((s) => s.delete(GroupId(crypto.randomUUID()))),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// GroupService.setMembers
// ---------------------------------------------------------------------------

describe("GroupService.setMembers", () => {
	it("replaces the member set of an existing group", async () => {
		const env = makeTestEnv();
		const groupId = crypto.randomUUID();
		const userId1 = crypto.randomUUID();
		const userId2 = crypto.randomUUID();
		env
			.withGroup({ id: groupId })
			.withUser({ id: userId1 })
			.withUser({ id: userId2 });
		env.stores.memberships.set(groupId, new Set([userId1]));

		await runSuccess(
			GroupService.pipe(
				Effect.flatMap((s) =>
					s.setMembers(GroupId(groupId), [UserId(userId2)]),
				),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const members = env.stores.memberships.get(groupId);
		expect(members?.has(userId2)).toBe(true);
		// userId1 should no longer be a member
		expect(members?.has(userId1)).toBe(false);
	});

	it("sets empty member list (clears all members)", async () => {
		const env = makeTestEnv();
		const groupId = crypto.randomUUID();
		const userId = crypto.randomUUID();
		env.withGroup({ id: groupId }).withUser({ id: userId });
		env.stores.memberships.set(groupId, new Set([userId]));

		await runSuccess(
			GroupService.pipe(
				Effect.flatMap((s) => s.setMembers(GroupId(groupId), [])),
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(env.stores.memberships.get(groupId)?.size ?? 0).toBe(0);
	});

	it("fails with 404 when the group does not exist", async () => {
		const env = makeTestEnv();

		const err = (await runFailure(
			GroupService.pipe(
				Effect.flatMap((s) => s.setMembers(GroupId(crypto.randomUUID()), [])),
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});
