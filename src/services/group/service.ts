import type { Effect } from "effect";
import { Context } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import type { GroupId, UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
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
	) => Effect.Effect<GroupWithPrincipal, DavError | DatabaseError>;
	readonly update: (
		id: GroupId,
		input: UpdateGroup,
	) => Effect.Effect<GroupWithPrincipal, DavError | DatabaseError>;
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
