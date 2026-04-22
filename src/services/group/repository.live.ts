import { and, eq, isNull, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import {
	group,
	membership,
	principal,
	user,
} from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
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
	function* (id: GroupId) {
		yield* Effect.annotateCurrentSpan({ "group.id": id });
		yield* Effect.logTrace("repo.group.findById", { id });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(group)
				.innerJoin(principal, eq(principal.id, group.principalId))
				.where(and(eq(group.id, id), isNull(principal.deletedAt)))
				.limit(1),
		).pipe(
			Effect.map((r) => {
				if (!r[0]) {
					return Option.none<GroupWithPrincipal>();
				}
				const row = r[0];
				return Option.some({
					principal: row.principal,
					group: row.group,
				} satisfies GroupWithPrincipal);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.findById failed", e.cause),
	),
);

const create = Effect.fn("GroupRepository.create")(
	function* (input: { readonly slug: Slug; readonly displayName?: string }) {
		yield* Effect.annotateCurrentSpan({ "group.slug": input.slug });
		yield* Effect.logTrace("repo.group.create", { slug: input.slug });

		const principalRows = yield* runDbQuery((db) =>
			db
				.insert(principal)
				.values({
					principalType: "group",
					slug: input.slug,
					displayName: input.displayName,
				})
				.returning(),
		).pipe(
			Effect.mapError((e) =>
				isPgUniqueViolation(e.cause)
					? new ConflictError({
							field: "slug",
							message: "Group with this slug already exists",
						})
					: e,
			),
		);
		const principalRow = principalRows[0];
		if (!principalRow) {
			return yield* Effect.fail(
				new DatabaseError({
					cause: new Error("principal insert returned no rows"),
				}),
			);
		}

		const groupRows = yield* runDbQuery((db) =>
			db.insert(group).values({ principalId: principalRow.id }).returning(),
		);
		const groupRow = groupRows[0];
		if (!groupRow) {
			return yield* Effect.fail(
				new DatabaseError({
					cause: new Error("group insert returned no rows"),
				}),
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
	function* (id: GroupId, input: { readonly displayName?: string }) {
		yield* Effect.annotateCurrentSpan({ "group.id": id });
		yield* Effect.logTrace("repo.group.update", { id });

		if (input.displayName !== undefined) {
			const displayName = input.displayName;
			yield* runDbQuery((db) =>
				db
					.update(principal)
					.set({ displayName, updatedAt: sql`now()` })
					.from(group)
					.where(and(eq(group.id, id), eq(principal.id, group.principalId))),
			).pipe(Effect.asVoid);
		}

		const rows = yield* runDbQuery((db) =>
			db
				.select()
				.from(group)
				.innerJoin(principal, eq(principal.id, group.principalId))
				.where(and(eq(group.id, id), isNull(principal.deletedAt)))
				.limit(1),
		);
		const row = rows[0];
		if (!row) {
			return yield* Effect.fail(
				new DatabaseError({
					cause: new Error(`Group not found after update: ${id}`),
				}),
			);
		}
		return {
			principal: row.principal,
			group: row.group,
		} satisfies GroupWithPrincipal;
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.update failed", e.cause),
	),
);

const addMember = Effect.fn("GroupRepository.addMember")(
	function* (groupId: GroupId, userId: UserId) {
		yield* Effect.annotateCurrentSpan({
			"group.id": groupId,
			"user.id": userId,
		});
		yield* Effect.logTrace("repo.group.addMember", { groupId, userId });
		return yield* runDbQuery((db) =>
			db.insert(membership).values({ groupId, userId }).onConflictDoNothing(),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.addMember failed", e.cause),
	),
);

const removeMember = Effect.fn("GroupRepository.removeMember")(
	function* (groupId: GroupId, userId: UserId) {
		yield* Effect.annotateCurrentSpan({
			"group.id": groupId,
			"user.id": userId,
		});
		yield* Effect.logTrace("repo.group.removeMember", { groupId, userId });
		return yield* runDbQuery((db) =>
			db
				.delete(membership)
				.where(
					and(eq(membership.groupId, groupId), eq(membership.userId, userId)),
				),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.removeMember failed", e.cause),
	),
);

const hasMember = Effect.fn("GroupRepository.hasMember")(
	function* (groupId: GroupId, userId: UserId) {
		yield* Effect.annotateCurrentSpan({
			"group.id": groupId,
			"user.id": userId,
		});
		yield* Effect.logTrace("repo.group.hasMember", { groupId, userId });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(membership)
				.where(
					and(eq(membership.groupId, groupId), eq(membership.userId, userId)),
				)
				.limit(1),
		).pipe(Effect.map((r) => r.length > 0));
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.hasMember failed", e.cause),
	),
);

const findByPrincipalId = Effect.fn("GroupRepository.findByPrincipalId")(
	function* (principalId: PrincipalId) {
		yield* Effect.annotateCurrentSpan({ "group.principalId": principalId });
		yield* Effect.logTrace("repo.group.findByPrincipalId", { principalId });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(group)
				.innerJoin(principal, eq(principal.id, group.principalId))
				.where(
					and(eq(group.principalId, principalId), isNull(principal.deletedAt)),
				)
				.limit(1),
		).pipe(
			Effect.map((r) => {
				if (!r[0]) {
					return Option.none<GroupWithPrincipal>();
				}
				const row = r[0];
				return Option.some({
					principal: row.principal,
					group: row.group,
				} satisfies GroupWithPrincipal);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.findByPrincipalId failed", e.cause),
	),
);

const findBySlug = Effect.fn("GroupRepository.findBySlug")(
	function* (slug: Slug) {
		yield* Effect.annotateCurrentSpan({ "group.slug": slug });
		yield* Effect.logTrace("repo.group.findBySlug", { slug });
		return yield* runDbQuery((db) =>
			db
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
				.limit(1),
		).pipe(
			Effect.map((r) => {
				if (!r[0]) {
					return Option.none<GroupWithPrincipal>();
				}
				const row = r[0];
				return Option.some({
					principal: row.principal,
					group: row.group,
				} satisfies GroupWithPrincipal);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.findBySlug failed", e.cause),
	),
);

const list = Effect.fn("GroupRepository.list")(
	function* () {
		yield* Effect.logTrace("repo.group.list");
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(group)
				.innerJoin(principal, eq(principal.id, group.principalId))
				.where(isNull(principal.deletedAt))
				.orderBy(principal.slug),
		).pipe(
			Effect.map((rows) =>
				rows.map(
					(r) =>
						({
							principal: r.principal,
							group: r.group,
						}) satisfies GroupWithPrincipal,
				),
			),
		);
	},
	Effect.tapError((e) => Effect.logWarning("repo.group.list failed", e.cause)),
);

const listMembers = Effect.fn("GroupRepository.listMembers")(
	function* (groupId: GroupId) {
		yield* Effect.annotateCurrentSpan({ "group.id": groupId });
		yield* Effect.logTrace("repo.group.listMembers", { groupId });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(user)
				.innerJoin(principal, eq(principal.id, user.principalId))
				.innerJoin(membership, eq(membership.userId, user.id))
				.where(
					and(eq(membership.groupId, groupId), isNull(principal.deletedAt)),
				)
				.orderBy(principal.slug),
		).pipe(
			Effect.map((rows) =>
				rows.map(
					(r) =>
						({
							principal: r.principal,
							user: r.user,
						}) satisfies UserWithPrincipal,
				),
			),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.listMembers failed", e.cause),
	),
);

const listByMember = Effect.fn("GroupRepository.listByMember")(
	function* (userId: UserId) {
		yield* Effect.annotateCurrentSpan({ "user.id": userId });
		yield* Effect.logTrace("repo.group.listByMember", { userId });
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(group)
				.innerJoin(principal, eq(principal.id, group.principalId))
				.innerJoin(membership, eq(membership.groupId, group.id))
				.where(and(eq(membership.userId, userId), isNull(principal.deletedAt)))
				.orderBy(principal.slug),
		).pipe(
			Effect.map((rows) =>
				rows.map(
					(r) =>
						({
							principal: r.principal,
							group: r.group,
						}) satisfies GroupWithPrincipal,
				),
			),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.listByMember failed", e.cause),
	),
);

const softDelete = Effect.fn("GroupRepository.softDelete")(
	function* (id: GroupId) {
		yield* Effect.annotateCurrentSpan({ "group.id": id });
		yield* Effect.logTrace("repo.group.softDelete", { id });
		return yield* runDbQuery((db) =>
			db
				.update(principal)
				.set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
				.from(group)
				.where(and(eq(group.id, id), eq(principal.id, group.principalId))),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.softDelete failed", e.cause),
	),
);

const setMembers = Effect.fn("GroupRepository.setMembers")(
	function* (groupId: GroupId, userIds: ReadonlyArray<UserId>) {
		yield* Effect.annotateCurrentSpan({
			"group.id": groupId,
			"group.member_count": userIds.length,
		});
		yield* Effect.logTrace("repo.group.setMembers", {
			groupId,
			count: userIds.length,
		});
		yield* runDbQuery((db) =>
			db.delete(membership).where(eq(membership.groupId, groupId)),
		).pipe(Effect.asVoid);
		if (userIds.length > 0) {
			yield* runDbQuery((db) =>
				db
					.insert(membership)
					.values(userIds.map((userId) => ({ groupId, userId })))
					.onConflictDoNothing(),
			).pipe(Effect.asVoid);
		}
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.group.setMembers failed", e.cause),
	),
);

export const GroupRepositoryLive = Layer.effect(
	GroupRepository,
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(
			e: Effect.Effect<A, E, DatabaseClient>,
		): Effect.Effect<A, E> => Effect.provideService(e, DatabaseClient, dc);
		return GroupRepository.of({
			findById: (...args: Parameters<typeof findById>) =>
				run(findById(...args)),
			findByPrincipalId: (...args: Parameters<typeof findByPrincipalId>) =>
				run(findByPrincipalId(...args)),
			findBySlug: (...args: Parameters<typeof findBySlug>) =>
				run(findBySlug(...args)),
			list: (...args: Parameters<typeof list>) => run(list(...args)),
			listMembers: (...args: Parameters<typeof listMembers>) =>
				run(listMembers(...args)),
			listByMember: (...args: Parameters<typeof listByMember>) =>
				run(listByMember(...args)),
			softDelete: (...args: Parameters<typeof softDelete>) =>
				run(softDelete(...args)),
			setMembers: (...args: Parameters<typeof setMembers>) =>
				run(setMembers(...args)),
			create: (...args: Parameters<typeof create>) => run(create(...args)),
			update: (...args: Parameters<typeof update>) => run(update(...args)),
			addMember: (...args: Parameters<typeof addMember>) =>
				run(addMember(...args)),
			removeMember: (...args: Parameters<typeof removeMember>) =>
				run(removeMember(...args)),
			hasMember: (...args: Parameters<typeof hasMember>) =>
				run(hasMember(...args)),
		});
	}),
);
