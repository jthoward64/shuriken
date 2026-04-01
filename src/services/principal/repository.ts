import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { principal, user } from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { PrincipalId, UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { Email } from "#src/domain/types/strings.ts";

// ---------------------------------------------------------------------------
// PrincipalRepository — data access for principal + user rows
// ---------------------------------------------------------------------------

export type PrincipalRow = InferSelectModel<typeof principal>;
export type UserRow = InferSelectModel<typeof user>;

export interface PrincipalWithUser {
	readonly principal: PrincipalRow;
	readonly user: UserRow;
}

export interface PrincipalRepositoryShape {
	readonly findById: (
		id: PrincipalId,
	) => Effect.Effect<Option.Option<PrincipalRow>, DatabaseError>;
	readonly findBySlug: (
		slug: Slug,
	) => Effect.Effect<Option.Option<PrincipalWithUser>, DatabaseError>;
	readonly findByEmail: (
		email: Email,
	) => Effect.Effect<Option.Option<PrincipalWithUser>, DatabaseError>;
	readonly findUserByUserId: (
		id: UserId,
	) => Effect.Effect<Option.Option<UserRow>, DatabaseError>;
}

export class PrincipalRepository extends Context.Tag("PrincipalRepository")<
	PrincipalRepository,
	PrincipalRepositoryShape
>() {}
