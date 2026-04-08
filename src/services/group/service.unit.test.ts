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
