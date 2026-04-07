import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import { group, membership, principal } from "#src/db/drizzle/schema/index.ts";
import { ConflictError, DatabaseError, isPgUniqueViolation } from "#src/domain/errors.ts";
import type { GroupId, UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import { GroupRepository, type GroupWithPrincipal } from "./repository.ts";

// ---------------------------------------------------------------------------
// GroupRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const findById = Effect.fn("GroupRepository.findById")(function* (
	db: DbClient,
	id: GroupId,
) {
	yield* Effect.logTrace("repo.group.findById", { id });
	return yield* Effect.tryPromise({
		try: () =>
			db
				.select()
				.from(group)
				.innerJoin(principal, eq(principal.id, group.principalId))
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
					} satisfies GroupWithPrincipal);
				}),
		catch: (e) => new DatabaseError({ cause: e }),
	});
}, Effect.tapError((e) => Effect.logWarning("repo.group.findById failed", e.cause)));

const create = Effect.fn("GroupRepository.create")(function* (
	db: DbClient,
	input: {
		readonly slug: Slug;
		readonly displayName?: string;
	},
) {
	yield* Effect.logTrace("repo.group.create", { slug: input.slug });
	return yield* Effect.tryPromise<GroupWithPrincipal, DatabaseError | ConflictError>({
		try: () =>
			db.transaction(async (tx) => {
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

				const groupRows = await tx
					.insert(group)
					.values({ principalId: principalRow.id })
					.returning();
				const groupRow = groupRows[0];
				if (!groupRow) {
					throw new Error("group insert returned no rows");
				}

				return {
					principal: principalRow,
					group: groupRow,
				} satisfies GroupWithPrincipal;
			}),
		catch: (e) =>
			isPgUniqueViolation(e)
				? new ConflictError({
						field: "slug",
						message: "Group with this slug already exists",
					})
				: new DatabaseError({ cause: e }),
	});
}, Effect.tapError((e) => Effect.logWarning("repo.group.create failed", e.cause)));

const update = Effect.fn("GroupRepository.update")(function* (
	db: DbClient,
	id: GroupId,
	input: { readonly displayName?: string },
) {
	yield* Effect.logTrace("repo.group.update", { id });
	return yield* Effect.tryPromise({
		try: async () => {
			if (input.displayName !== undefined) {
				await db
					.update(principal)
					.set({ displayName: input.displayName, updatedAt: sql`now()` })
					.from(group)
					.where(and(eq(group.id, id), eq(principal.id, group.principalId)));
			}

			const rows = await db
				.select()
				.from(group)
				.innerJoin(principal, eq(principal.id, group.principalId))
				.where(and(eq(group.id, id), isNull(principal.deletedAt)))
				.limit(1);

			const row = rows[0];
			if (!row) {
				throw new Error(`Group not found after update: ${id}`);
			}
			return {
				principal: row.principal,
				group: row.group,
			} satisfies GroupWithPrincipal;
		},
		catch: (e) => new DatabaseError({ cause: e }),
	});
}, Effect.tapError((e) => Effect.logWarning("repo.group.update failed", e.cause)));

const addMember = Effect.fn("GroupRepository.addMember")(function* (
	db: DbClient,
	groupId: GroupId,
	userId: UserId,
) {
	yield* Effect.logTrace("repo.group.addMember", { groupId, userId });
	return yield* Effect.tryPromise({
		try: () =>
			db
				.insert(membership)
				.values({ groupId, userId })
				.onConflictDoNothing()
				.then(() => undefined),
		catch: (e) => new DatabaseError({ cause: e }),
	});
}, Effect.tapError((e) => Effect.logWarning("repo.group.addMember failed", e.cause)));

const removeMember = Effect.fn("GroupRepository.removeMember")(function* (
	db: DbClient,
	groupId: GroupId,
	userId: UserId,
) {
	yield* Effect.logTrace("repo.group.removeMember", { groupId, userId });
	return yield* Effect.tryPromise({
		try: () =>
			db
				.delete(membership)
				.where(
					and(eq(membership.groupId, groupId), eq(membership.userId, userId)),
				)
				.then(() => undefined),
		catch: (e) => new DatabaseError({ cause: e }),
	});
}, Effect.tapError((e) => Effect.logWarning("repo.group.removeMember failed", e.cause)));

const hasMember = Effect.fn("GroupRepository.hasMember")(function* (
	db: DbClient,
	groupId: GroupId,
	userId: UserId,
) {
	yield* Effect.logTrace("repo.group.hasMember", { groupId, userId });
	return yield* Effect.tryPromise({
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
}, Effect.tapError((e) => Effect.logWarning("repo.group.hasMember failed", e.cause)));

export const GroupRepositoryLive = Layer.effect(
	GroupRepository,
	Effect.map(DatabaseClient, (db) =>
		GroupRepository.of({
			findById: (id) => findById(db, id),
			create: (input) => create(db, input),
			update: (id, input) => update(db, id, input),
			addMember: (groupId, userId) => addMember(db, groupId, userId),
			removeMember: (groupId, userId) => removeMember(db, groupId, userId),
			hasMember: (groupId, userId) => hasMember(db, groupId, userId),
		}),
	),
);
