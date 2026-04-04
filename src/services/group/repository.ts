import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type {
	group,
	membership,
	principal,
} from "#src/db/drizzle/schema/index.ts";
import type { ConflictError, DatabaseError } from "#src/domain/errors.ts";
import type { GroupId, UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";

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

export interface GroupRepositoryShape {
	readonly findById: (
		id: GroupId,
	) => Effect.Effect<Option.Option<GroupWithPrincipal>, DatabaseError>;
	readonly create: (input: {
		readonly slug: Slug;
		readonly displayName?: string;
	}) => Effect.Effect<GroupWithPrincipal, DatabaseError | ConflictError>;
	readonly update: (
		id: GroupId,
		input: { readonly displayName?: string },
	) => Effect.Effect<GroupWithPrincipal, DatabaseError>;
	readonly addMember: (
		groupId: GroupId,
		userId: UserId,
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

export class GroupRepository extends Context.Tag("GroupRepository")<
	GroupRepository,
	GroupRepositoryShape
>() {}
