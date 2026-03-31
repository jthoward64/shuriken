import type { InferSelectModel } from "drizzle-orm";
import type { Effect } from "effect";
import { Context } from "effect";
import type { principal, user } from "#/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#/domain/errors.ts";
import type { PrincipalId, UserId } from "#/domain/ids.ts";
import type { Slug } from "#/domain/types/path.ts";

// ---------------------------------------------------------------------------
// PrincipalRepository — data access for principal + user rows
// ---------------------------------------------------------------------------

export type PrincipalRow = InferSelectModel<typeof principal>;
export type UserRow = InferSelectModel<typeof user>;

export type PrincipalWithUser = {
	readonly principal: PrincipalRow;
	readonly user: UserRow;
};

export interface PrincipalRepositoryShape {
	readonly findById: (
		id: PrincipalId,
	) => Effect<PrincipalRow | null, DatabaseError>;
	readonly findBySlug: (
		slug: Slug,
	) => Effect<PrincipalWithUser | null, DatabaseError>;
	readonly findByEmail: (
		email: string,
	) => Effect<PrincipalWithUser | null, DatabaseError>;
	readonly findUserByUserId: (
		id: UserId,
	) => Effect<UserRow | null, DatabaseError>;
}

export class PrincipalRepository extends Context.Tag("PrincipalRepository")<
	PrincipalRepository,
	PrincipalRepositoryShape
>() {}
