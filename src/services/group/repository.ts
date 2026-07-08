import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type {
	AutoAssignedBySource,
	group,
	membership,
	principal,
} from "#src/db/drizzle/schema/index.ts";
import type { ConflictError, DatabaseError } from "#src/domain/errors.ts";
import type { GroupId, PrincipalId, UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { UserWithPrincipal } from "#src/services/user/repository.ts";

export type { AutoAssignedBySource } from "#src/db/drizzle/schema/index.ts";

// ---------------------------------------------------------------------------
// GroupRepository — data access for group + principal + membership
// ---------------------------------------------------------------------------

export type PrincipalRow = InferSelectModel<typeof principal>;
export type GroupRow = InferSelectModel<typeof group>;
export type MembershipRow = InferSelectModel<typeof membership>;

export interface GroupWithPrincipal {
	readonly principal: PrincipalRow;
	readonly group: GroupRow;
}

export interface GroupMember extends UserWithPrincipal {
	readonly autoAssignedBy: AutoAssignedBySource | null;
}

export interface GroupMembership extends GroupWithPrincipal {
	readonly autoAssignedBy: AutoAssignedBySource | null;
}

export interface GroupRepositoryShape {
	readonly findById: (
		id: GroupId,
	) => Effect.Effect<Option.Option<GroupWithPrincipal>, DatabaseError>;
	readonly findByPrincipalId: (
		principalId: PrincipalId,
	) => Effect.Effect<Option.Option<GroupWithPrincipal>, DatabaseError>;
	readonly findBySlug: (
		slug: Slug,
	) => Effect.Effect<Option.Option<GroupWithPrincipal>, DatabaseError>;
	readonly list: () => Effect.Effect<
		ReadonlyArray<GroupWithPrincipal>,
		DatabaseError
	>;
	readonly listMembers: (
		groupId: GroupId,
	) => Effect.Effect<ReadonlyArray<GroupMember>, DatabaseError>;
	readonly listByMember: (
		userId: UserId,
	) => Effect.Effect<ReadonlyArray<GroupMembership>, DatabaseError>;
	readonly listAutoAssignedGroupIds: (
		userId: UserId,
		source: AutoAssignedBySource,
	) => Effect.Effect<ReadonlyArray<GroupId>, DatabaseError>;
	readonly softDelete: (id: GroupId) => Effect.Effect<void, DatabaseError>;
	readonly setMembers: (
		groupId: GroupId,
		userIds: ReadonlyArray<UserId>,
	) => Effect.Effect<void, DatabaseError>;
	readonly create: (input: {
		readonly slug: Slug;
		readonly displayName?: string;
		readonly oidcGroups?: ReadonlyArray<string>;
	}) => Effect.Effect<GroupWithPrincipal, DatabaseError | ConflictError>;
	readonly update: (
		id: GroupId,
		input: {
			readonly displayName?: string;
			readonly oidcGroups?: ReadonlyArray<string>;
		},
	) => Effect.Effect<GroupWithPrincipal, DatabaseError>;
	readonly addMember: (
		groupId: GroupId,
		userId: UserId,
		autoAssignedBy?: AutoAssignedBySource | null,
	) => Effect.Effect<void, DatabaseError>;
	readonly removeMember: (
		groupId: GroupId,
		userId: UserId,
	) => Effect.Effect<void, DatabaseError>;
	readonly hasMember: (
		groupId: GroupId,
		userId: UserId,
	) => Effect.Effect<boolean, DatabaseError>;
}

export class GroupRepository extends Context.Service<
	GroupRepository,
	GroupRepositoryShape
>()("GroupRepository") {}
