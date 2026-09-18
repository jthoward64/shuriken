import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type { GroupId } from "#src/domain/ids.ts";
import type {
	GroupMember,
	GroupMembership,
	GroupRepositoryShape,
	GroupRow,
	GroupWithPrincipal,
} from "#src/services/group/repository.ts";
import type { PrincipalRow } from "#src/services/principal/repository.ts";
import { allGroupPrincipals, allGroups, type TestStores } from "./stores.ts";

// ---------------------------------------------------------------------------
// In-memory GroupRepository
// ---------------------------------------------------------------------------

/** Pairs a group row with its principal, or none when either side is missing */
const withGroupPrincipal = (
	stores: TestStores,
	groupRow: GroupRow | undefined,
): Option.Option<GroupWithPrincipal> =>
	Option.flatMap(Option.fromNullishOr(groupRow), (group) =>
		Option.map(
			Option.fromNullishOr(stores.groupPrincipals.get(group.principalId)),
			(principal) => ({ principal, group }),
		),
	);

/** Pairs a group principal with its group row, or none when either is missing */
const withGroup = (
	stores: TestStores,
	principalRow: PrincipalRow | undefined,
): Option.Option<GroupWithPrincipal> =>
	Option.flatMap(Option.fromNullishOr(principalRow), (principal) =>
		Option.map(
			Option.fromNullishOr(
				allGroups(stores).find((g) => g.principalId === principal.id),
			),
			(group) => ({ principal, group }),
		),
	);

// The group principal with this id, only while it is not soft-deleted
const liveGroupPrincipal = (
	stores: TestStores,
	principalId: string,
): PrincipalRow | undefined => {
	const principal = stores.groupPrincipals.get(principalId);
	return principal && principal.deletedAt === null ? principal : undefined;
};

// How a membership was assigned, or null when it was assigned by hand
const membershipSource = (
	stores: TestStores,
	groupId: string,
	userId: string,
) => stores.membershipAutoAssignedBy.get(`${groupId}:${userId}`) ?? null;

// Every group whose principal is still live
const listLiveGroups = (
	stores: TestStores,
): ReadonlyArray<GroupWithPrincipal> =>
	allGroups(stores).flatMap((group) => {
		const principal = stores.groupPrincipals.get(group.principalId);
		return principal && principal.deletedAt === null
			? [{ principal, group }]
			: [];
	});

// Members of a group, skipping users whose principal is gone or deleted
const listMemberRows = (
	stores: TestStores,
	groupId: string,
): ReadonlyArray<GroupMember> =>
	[...(stores.memberships.get(groupId) ?? new Set<string>())].flatMap(
		(userId) => {
			const user = stores.users.get(userId);
			const principal = user
				? stores.principals.get(user.principalId)
				: undefined;
			return user && principal && principal.deletedAt === null
				? [
						{
							user,
							principal,
							autoAssignedBy: membershipSource(stores, groupId, userId),
						},
					]
				: [];
		},
	);

// Groups this user belongs to, skipping groups whose principal is deleted
const listGroupsOfMember = (
	stores: TestStores,
	userId: string,
): ReadonlyArray<GroupMembership> =>
	[...stores.groups.entries()].flatMap(([groupId, group]) => {
		const principal = stores.groupPrincipals.get(group.principalId);
		return stores.memberships.get(groupId)?.has(userId) &&
			principal &&
			principal.deletedAt === null
			? [
					{
						principal,
						group,
						autoAssignedBy: membershipSource(stores, groupId, userId),
					},
				]
			: [];
	});

export const makeGroupRepo = (stores: TestStores): GroupRepositoryShape => ({
	findById: (id) =>
		Effect.succeed(withGroupPrincipal(stores, stores.groups.get(id))),

	create: (input) =>
		Effect.sync(() => {
			const now = Temporal.Now.instant();
			const principalId = crypto.randomUUID();
			const groupId = crypto.randomUUID();

			const principalRow: PrincipalRow = {
				id: principalId,
				principalType: "group",
				displayName: input.displayName ?? null,
				updatedAt: now,
				deletedAt: null,
				slug: input.slug,
				clientProperties: {},
			};
			const groupRow: GroupRow = {
				id: groupId,
				principalId,
				oidcGroups: input.oidcGroups ? [...input.oidcGroups] : [],
				updatedAt: now,
			};

			stores.groupPrincipals.set(principalId, principalRow);
			stores.groups.set(groupId, groupRow);

			return { principal: principalRow, group: groupRow };
		}),

	update: (id, input) =>
		Effect.sync(() => {
			const groupRow = stores.groups.get(id);
			if (!groupRow) {
				throw new Error(`[TestEnv] Group not found: ${id}`);
			}
			const principal = stores.groupPrincipals.get(groupRow.principalId);
			if (!principal) {
				throw new Error(
					`[TestEnv] Group principal not found: ${groupRow.principalId}`,
				);
			}

			const now = Temporal.Now.instant();

			if (input.displayName !== undefined) {
				stores.groupPrincipals.set(groupRow.principalId, {
					...principal,
					displayName: input.displayName,
					updatedAt: now,
				});
			}

			const updatedGroupRow: GroupRow =
				input.oidcGroups !== undefined
					? { ...groupRow, oidcGroups: [...input.oidcGroups], updatedAt: now }
					: groupRow;
			stores.groups.set(id, updatedGroupRow);

			const updatedPrincipal =
				stores.groupPrincipals.get(groupRow.principalId) ?? principal;

			return { principal: updatedPrincipal, group: updatedGroupRow };
		}),

	addMember: (groupId, userId, autoAssignedBy = null) =>
		Effect.sync(() => {
			const members = stores.memberships.get(groupId) ?? new Set<string>();
			members.add(userId);
			stores.memberships.set(groupId, members);
			stores.membershipAutoAssignedBy.set(
				`${groupId}:${userId}`,
				autoAssignedBy,
			);
		}),

	removeMember: (groupId, userId) =>
		Effect.sync(() => {
			stores.memberships.get(groupId)?.delete(userId);
			stores.membershipAutoAssignedBy.delete(`${groupId}:${userId}`);
		}),

	hasMember: (groupId, userId) =>
		Effect.succeed(stores.memberships.get(groupId)?.has(userId) ?? false),

	findBySlug: (slug) =>
		Effect.succeed(
			withGroup(
				stores,
				allGroupPrincipals(stores).find(
					(p) => p.slug === slug && p.deletedAt === null,
				),
			),
		),

	findByPrincipalId: (principalId) =>
		Effect.succeed(withGroup(stores, liveGroupPrincipal(stores, principalId))),

	list: () => Effect.succeed(listLiveGroups(stores)),

	listMembers: (groupId) => Effect.succeed(listMemberRows(stores, groupId)),

	listByMember: (userId) => Effect.succeed(listGroupsOfMember(stores, userId)),

	listAutoAssignedGroupIds: (userId, source) =>
		Effect.succeed(
			[...stores.groups.keys()].filter(
				(groupId) =>
					stores.membershipAutoAssignedBy.get(`${groupId}:${userId}`) ===
					source,
			) as Array<GroupId>,
		),

	softDelete: (id) =>
		Effect.sync(() => {
			const groupRow = stores.groups.get(id);
			if (!groupRow) {
				return;
			}
			const principal = stores.groupPrincipals.get(groupRow.principalId);
			if (!principal) {
				return;
			}
			stores.groupPrincipals.set(groupRow.principalId, {
				...principal,
				deletedAt: Temporal.Now.instant(),
			});
		}),

	setMembers: (groupId, userIds) =>
		Effect.sync(() => {
			for (const userId of stores.memberships.get(groupId) ?? []) {
				stores.membershipAutoAssignedBy.delete(`${groupId}:${userId}`);
			}
			stores.memberships.set(groupId, new Set(userIds));
			for (const userId of userIds) {
				stores.membershipAutoAssignedBy.set(`${groupId}:${userId}`, null);
			}
		}),
});
