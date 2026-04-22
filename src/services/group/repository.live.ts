import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient, type DbClient } from "#src/db/client.ts";
import {
	group,
	membership,
	principal,
	user,
} from "#src/db/drizzle/schema/index.ts";
import { getActiveDb } from "#src/db/transaction.ts";
import {
	ConflictError,
	DatabaseError,
	isPgUniqueViolation,
} from "#src/domain/errors.ts";
import type { GroupId, PrincipalId, UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { UserWithPrincipal } from "#src/services/user/repository.ts";
import { GroupRepository, type GroupWithPrincipal } from "./repository.ts";

// ---------------------------------------------------------------------------
// GroupRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const findById = Effect.fn("GroupRepository.findById")(
	function* (db: DbClient, id: GroupId) {
		yield* Effect.annotateCurrentSpan({ "group.id": id });
		yield* Effect.logTrace("repo.group.findById", { id });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
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
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.findById failed", e.cause),
	),
);

const create = Effect.fn("GroupRepository.create")(
	function* (
		db: DbClient,
		input: {
			readonly slug: Slug;
			readonly displayName?: string;
		},
	) {
		yield* Effect.annotateCurrentSpan({ "group.slug": input.slug });
		yield* Effect.logTrace("repo.group.create", { slug: input.slug });
		const activeDb = yield* getActiveDb(db);

		const principalRows = yield* Effect.tryPromise<
			ReadonlyArray<typeof principal.$inferSelect>,
			DatabaseError | ConflictError
		>({
			try: () =>
				activeDb
					.insert(principal)
					.values({
						principalType: "group",
						slug: input.slug,
						displayName: input.displayName,
					})
					.returning(),
			catch: (e) =>
				isPgUniqueViolation(e)
					? new ConflictError({
							field: "slug",
							message: "Group with this slug already exists",
						})
					: new DatabaseError({ cause: e }),
		});
		const principalRow = principalRows[0];
		if (!principalRow) {
			return yield* Effect.fail(
				new DatabaseError({ cause: new Error("principal insert returned no rows") }),
			);
		}

		const groupRows = yield* Effect.tryPromise({
			try: () =>
				activeDb
					.insert(group)
					.values({ principalId: principalRow.id })
					.returning(),
			catch: (e) => new DatabaseError({ cause: e }),
		});
		const groupRow = groupRows[0];
		if (!groupRow) {
			return yield* Effect.fail(
				new DatabaseError({ cause: new Error("group insert returned no rows") }),
			);
		}

		return {
			principal: principalRow,
			group: groupRow,
		} satisfies GroupWithPrincipal;
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.create failed", e.cause),
	),
);

const update = Effect.fn("GroupRepository.update")(
	function* (
		db: DbClient,
		id: GroupId,
		input: { readonly displayName?: string },
	) {
		yield* Effect.annotateCurrentSpan({ "group.id": id });
		yield* Effect.logTrace("repo.group.update", { id });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: async () => {
				if (input.displayName !== undefined) {
					await activeDb
						.update(principal)
						.set({ displayName: input.displayName, updatedAt: sql`now()` })
						.from(group)
						.where(and(eq(group.id, id), eq(principal.id, group.principalId)));
				}

				const rows = await activeDb
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
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.update failed", e.cause),
	),
);

const addMember = Effect.fn("GroupRepository.addMember")(
	function* (db: DbClient, groupId: GroupId, userId: UserId) {
		yield* Effect.annotateCurrentSpan({
			"group.id": groupId,
			"user.id": userId,
		});
		yield* Effect.logTrace("repo.group.addMember", { groupId, userId });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.insert(membership)
					.values({ groupId, userId })
					.onConflictDoNothing()
					.then(() => undefined),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.addMember failed", e.cause),
	),
);

const removeMember = Effect.fn("GroupRepository.removeMember")(
	function* (db: DbClient, groupId: GroupId, userId: UserId) {
		yield* Effect.annotateCurrentSpan({
			"group.id": groupId,
			"user.id": userId,
		});
		yield* Effect.logTrace("repo.group.removeMember", { groupId, userId });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.delete(membership)
					.where(
						and(eq(membership.groupId, groupId), eq(membership.userId, userId)),
					)
					.then(() => undefined),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.removeMember failed", e.cause),
	),
);

const hasMember = Effect.fn("GroupRepository.hasMember")(
	function* (db: DbClient, groupId: GroupId, userId: UserId) {
		yield* Effect.annotateCurrentSpan({
			"group.id": groupId,
			"user.id": userId,
		});
		yield* Effect.logTrace("repo.group.hasMember", { groupId, userId });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.select()
					.from(membership)
					.where(
						and(eq(membership.groupId, groupId), eq(membership.userId, userId)),
					)
					.limit(1)
					.then((r) => r.length > 0),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.hasMember failed", e.cause),
	),
);

const findByPrincipalId = Effect.fn("GroupRepository.findByPrincipalId")(
	function* (db: DbClient, principalId: PrincipalId) {
		yield* Effect.annotateCurrentSpan({ "group.principalId": principalId });
		yield* Effect.logTrace("repo.group.findByPrincipalId", { principalId });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.select()
					.from(group)
					.innerJoin(principal, eq(principal.id, group.principalId))
					.where(and(eq(group.principalId, principalId), isNull(principal.deletedAt)))
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
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.findByPrincipalId failed", e.cause),
	),
);

const findBySlug = Effect.fn("GroupRepository.findBySlug")(
	function* (db: DbClient, slug: Slug) {
		yield* Effect.annotateCurrentSpan({ "group.slug": slug });
		yield* Effect.logTrace("repo.group.findBySlug", { slug });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.select()
					.from(group)
					.innerJoin(principal, eq(principal.id, group.principalId))
					.where(
						and(
							eq(principal.slug, slug),
							eq(principal.principalType, "group"),
							isNull(principal.deletedAt),
						),
					)
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
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.findBySlug failed", e.cause),
	),
);

const list = Effect.fn("GroupRepository.list")(
	function* (db: DbClient) {
		yield* Effect.logTrace("repo.group.list");
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.select()
					.from(group)
					.innerJoin(principal, eq(principal.id, group.principalId))
					.where(isNull(principal.deletedAt))
					.orderBy(principal.slug)
					.then((rows) =>
						rows.map(
							(r) =>
								({
									principal: r.principal,
									group: r.group,
								}) satisfies GroupWithPrincipal,
						),
					),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) => Effect.logWarning("repo.group.list failed", e.cause)),
);

const listMembers = Effect.fn("GroupRepository.listMembers")(
	function* (db: DbClient, groupId: GroupId) {
		yield* Effect.annotateCurrentSpan({ "group.id": groupId });
		yield* Effect.logTrace("repo.group.listMembers", { groupId });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.select()
					.from(user)
					.innerJoin(principal, eq(principal.id, user.principalId))
					.innerJoin(membership, eq(membership.userId, user.id))
					.where(
						and(eq(membership.groupId, groupId), isNull(principal.deletedAt)),
					)
					.orderBy(principal.slug)
					.then((rows) =>
						rows.map(
							(r) =>
								({
									principal: r.principal,
									user: r.user,
								}) satisfies UserWithPrincipal,
						),
					),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.listMembers failed", e.cause),
	),
);

const listByMember = Effect.fn("GroupRepository.listByMember")(
	function* (db: DbClient, userId: UserId) {
		yield* Effect.annotateCurrentSpan({ "user.id": userId });
		yield* Effect.logTrace("repo.group.listByMember", { userId });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.select()
					.from(group)
					.innerJoin(principal, eq(principal.id, group.principalId))
					.innerJoin(membership, eq(membership.groupId, group.id))
					.where(
						and(eq(membership.userId, userId), isNull(principal.deletedAt)),
					)
					.orderBy(principal.slug)
					.then((rows) =>
						rows.map(
							(r) =>
								({
									principal: r.principal,
									group: r.group,
								}) satisfies GroupWithPrincipal,
						),
					),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.listByMember failed", e.cause),
	),
);

const softDelete = Effect.fn("GroupRepository.softDelete")(
	function* (db: DbClient, id: GroupId) {
		yield* Effect.annotateCurrentSpan({ "group.id": id });
		yield* Effect.logTrace("repo.group.softDelete", { id });
		const activeDb = yield* getActiveDb(db);
		return yield* Effect.tryPromise({
			try: () =>
				activeDb
					.update(principal)
					.set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
					.from(group)
					.where(and(eq(group.id, id), eq(principal.id, group.principalId)))
					.then(() => undefined),
			catch: (e) => new DatabaseError({ cause: e }),
		});
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.softDelete failed", e.cause),
	),
);

const setMembers = Effect.fn("GroupRepository.setMembers")(
	function* (db: DbClient, groupId: GroupId, userIds: ReadonlyArray<UserId>) {
		yield* Effect.annotateCurrentSpan({
			"group.id": groupId,
			"group.member_count": userIds.length,
		});
		yield* Effect.logTrace("repo.group.setMembers", {
			groupId,
			count: userIds.length,
		});
		const activeDb = yield* getActiveDb(db);
		yield* Effect.tryPromise({
			try: () =>
				activeDb.delete(membership).where(eq(membership.groupId, groupId)),
			catch: (e) => new DatabaseError({ cause: e }),
		});
		if (userIds.length > 0) {
			yield* Effect.tryPromise({
				try: () =>
					activeDb
						.insert(membership)
						.values(userIds.map((userId) => ({ groupId, userId })))
						.onConflictDoNothing(),
				catch: (e) => new DatabaseError({ cause: e }),
			});
		}
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.setMembers failed", e.cause),
	),
);

export const GroupRepositoryLive = Layer.effect(
	GroupRepository,
	Effect.map(DatabaseClient, (db) =>
		GroupRepository.of({
			findById: (id) => findById(db, id),
			findByPrincipalId: (principalId) => findByPrincipalId(db, principalId),
			findBySlug: (slug) => findBySlug(db, slug),
			list: () => list(db),
			listMembers: (groupId) => listMembers(db, groupId),
			listByMember: (userId) => listByMember(db, userId),
			softDelete: (id) => softDelete(db, id),
			setMembers: (groupId, userIds) => setMembers(db, groupId, userIds),
			create: (input) => create(db, input),
			update: (id, input) => update(db, id, input),
			addMember: (groupId, userId) => addMember(db, groupId, userId),
			removeMember: (groupId, userId) => removeMember(db, groupId, userId),
			hasMember: (groupId, userId) => hasMember(db, groupId, userId),
		}),
	),
);
