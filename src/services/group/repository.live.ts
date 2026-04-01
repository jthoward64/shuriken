import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import {
	group,
	groupName,
	membership,
	principal,
} from "#src/db/drizzle/schema/index.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { GroupId, UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import {
	type GroupNameRow,
	GroupRepository,
	type GroupWithPrincipal,
} from "./repository.ts";

// ---------------------------------------------------------------------------
// GroupRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const findById = (db: DbClient, id: GroupId) =>
	Effect.tryPromise({
		try: () =>
			db
				.select()
				.from(group)
				.innerJoin(principal, eq(principal.id, group.principalId))
				.leftJoin(groupName, eq(groupName.id, group.primaryName))
				.where(and(eq(group.id, id), isNull(principal.deletedAt)))
				.limit(1)
				.then((r) => {
					if (!r[0]) {
						return Option.none<GroupWithPrincipal>();
					}
					const row = r[0];
					return Option.some({
						principal: row.principal,
						group: row.group,
						primaryGroupName: (row.group_name as GroupNameRow | null) ?? null,
					} satisfies GroupWithPrincipal);
				}),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const findByName = (db: DbClient, name: string) =>
	Effect.tryPromise({
		try: () =>
			db
				.select()
				.from(groupName)
				.where(eq(groupName.name, name))
				.limit(1)
				.then((r) => Option.fromNullable(r[0] as GroupNameRow | undefined)),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const create = (
	db: DbClient,
	input: {
		readonly slug: Slug;
		readonly primaryName: string;
		readonly displayName?: string;
	},
) =>
	Effect.tryPromise({
		try: () =>
			db.transaction(async (tx) => {
				// 1. Insert principal
				const principalRows = await tx
					.insert(principal)
					.values({
						principalType: "group",
						slug: input.slug,
						displayName: input.displayName,
					})
					.returning();
				const principalRow = principalRows[0];
				if (!principalRow) {
					throw new Error("principal insert returned no rows");
				}

				// 2. Insert group (primaryName null initially — circular FK)
				const groupRows = await tx
					.insert(group)
					.values({ principalId: principalRow.id })
					.returning();
				const groupRow = groupRows[0];
				if (!groupRow) {
					throw new Error("group insert returned no rows");
				}

				// 3. Insert group_name
				const nameRows = await tx
					.insert(groupName)
					.values({ groupId: groupRow.id, name: input.primaryName })
					.returning();
				const nameRow = nameRows[0];
				if (!nameRow) {
					throw new Error("group_name insert returned no rows");
				}

				// 4. Back-patch group.primaryName
				const updatedGroupRows = await tx
					.update(group)
					.set({ primaryName: nameRow.id, updatedAt: sql`now()` })
					.where(eq(group.id, groupRow.id))
					.returning();
				const updatedGroup = updatedGroupRows[0];
				if (!updatedGroup) {
					throw new Error("group update returned no rows");
				}

				return {
					principal: principalRow,
					group: updatedGroup,
					primaryGroupName: nameRow,
				} satisfies GroupWithPrincipal;
			}),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const update = (
	db: DbClient,
	id: GroupId,
	input: { readonly displayName?: string; readonly primaryName?: string },
) =>
	Effect.tryPromise({
		try: async () => {
			if (input.displayName !== undefined) {
				await db
					.update(principal)
					.set({ displayName: input.displayName, updatedAt: sql`now()` })
					.from(group)
					.where(and(eq(group.id, id), eq(principal.id, group.principalId)));
			}

			if (input.primaryName !== undefined) {
				// Update the name of the group's primary group_name entry
				await db
					.update(groupName)
					.set({ name: input.primaryName, updatedAt: sql`now()` })
					.from(group)
					.where(and(eq(group.id, id), eq(groupName.id, group.primaryName)));
			}

			const rows = await db
				.select()
				.from(group)
				.innerJoin(principal, eq(principal.id, group.principalId))
				.leftJoin(groupName, eq(groupName.id, group.primaryName))
				.where(and(eq(group.id, id), isNull(principal.deletedAt)))
				.limit(1);

			const row = rows[0];
			if (!row) {
				throw new Error(`Group not found after update: ${id}`);
			}
			return {
				principal: row.principal,
				group: row.group,
				primaryGroupName: (row.group_name as GroupNameRow | null) ?? null,
			} satisfies GroupWithPrincipal;
		},
		catch: (e) => new DatabaseError({ cause: e }),
	});

const addMember = (db: DbClient, groupId: GroupId, userId: UserId) =>
	Effect.tryPromise({
		try: () =>
			db
				.insert(membership)
				.values({ groupId, userId })
				.onConflictDoNothing()
				.then(() => undefined),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const removeMember = (db: DbClient, groupId: GroupId, userId: UserId) =>
	Effect.tryPromise({
		try: () =>
			db
				.delete(membership)
				.where(
					and(eq(membership.groupId, groupId), eq(membership.userId, userId)),
				)
				.then(() => undefined),
		catch: (e) => new DatabaseError({ cause: e }),
	});

const hasMember = (db: DbClient, groupId: GroupId, userId: UserId) =>
	Effect.tryPromise({
		try: () =>
			db
				.select()
				.from(membership)
				.where(
					and(eq(membership.groupId, groupId), eq(membership.userId, userId)),
				)
				.limit(1)
				.then((r) => r.length > 0),
		catch: (e) => new DatabaseError({ cause: e }),
	});

export const GroupRepositoryLive = Layer.effect(
	GroupRepository,
	Effect.map(DatabaseClient, (db) =>
		GroupRepository.of({
			findById: (id) => findById(db, id),
			findByName: (name) => findByName(db, name),
			create: (input) => create(db, input),
			update: (id, input) => update(db, id, input),
			addMember: (groupId, userId) => addMember(db, groupId, userId),
			removeMember: (groupId, userId) => removeMember(db, groupId, userId),
			hasMember: (groupId, userId) => hasMember(db, groupId, userId),
		}),
	),
);
