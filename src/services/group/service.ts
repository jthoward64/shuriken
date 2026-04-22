import type { Effect } from "effect";
import { Context } from "effect";
import type {
	ConflictError,
	DatabaseError,
	DavError,
} from "#src/domain/errors.ts";
import type { GroupId, PrincipalId, UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { UserWithPrincipal } from "#src/services/user/repository.ts";
import type { GroupWithPrincipal } from "./repository.ts";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface NewGroup {
	readonly slug: Slug;
	readonly displayName?: string;
}

export interface UpdateGroup {
	readonly displayName?: string;
}

// ---------------------------------------------------------------------------
// GroupService — business logic for group management
// ---------------------------------------------------------------------------

export interface GroupServiceShape {
	readonly create: (
		input: NewGroup,
	) => Effect.Effect<
		GroupWithPrincipal,
		DavError | DatabaseError | ConflictError
	>;
	readonly findById: (
		id: GroupId,
	) => Effect.Effect<GroupWithPrincipal, DavError | DatabaseError>;
	readonly findByPrincipalId: (
		principalId: PrincipalId,
	) => Effect.Effect<GroupWithPrincipal, DavError | DatabaseError>;
	readonly findBySlug: (
		slug: Slug,
	) => Effect.Effect<GroupWithPrincipal, DavError | DatabaseError>;
	readonly list: () => Effect.Effect<
		ReadonlyArray<GroupWithPrincipal>,
		DatabaseError
	>;
	readonly listMembers: (
		groupId: GroupId,
	) => Effect.Effect<
		ReadonlyArray<UserWithPrincipal>,
		DavError | DatabaseError
	>;
	readonly listByMember: (
		userId: UserId,
	) => Effect.Effect<ReadonlyArray<GroupWithPrincipal>, DatabaseError>;
	readonly update: (
		id: GroupId,
		input: UpdateGroup,
	) => Effect.Effect<GroupWithPrincipal, DavError | DatabaseError>;
	readonly delete: (
		id: GroupId,
	) => Effect.Effect<void, DavError | DatabaseError>;
	readonly setMembers: (
		groupId: GroupId,
		userIds: ReadonlyArray<UserId>,
	) => Effect.Effect<void, DavError | DatabaseError>;
	readonly addMember: (
		groupId: GroupId,
		userId: UserId,
	) => Effect.Effect<void, DavError | DatabaseError>;
	readonly removeMember: (
		groupId: GroupId,
		userId: UserId,
	) => Effect.Effect<void, DavError | DatabaseError>;
}

export class GroupService extends Context.Tag("GroupService")<
	GroupService,
	GroupServiceShape
>() {}
