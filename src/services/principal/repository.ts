import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { IrDeadProperties } from "#src/data/ir.ts";
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

export interface PrincipalPropertyChanges {
	readonly clientProperties: IrDeadProperties;
	/** undefined = leave unchanged; null = clear the value */
	readonly displayName?: string | null;
}

export interface PrincipalRepositoryShape {
	readonly findById: (
		id: PrincipalId,
	) => Effect.Effect<Option.Option<PrincipalWithUser>, DatabaseError>;
	readonly findBySlug: (
		slug: Slug,
	) => Effect.Effect<Option.Option<PrincipalWithUser>, DatabaseError>;
	/** Find any principal (user OR group) by slug — no user join required. */
	readonly findPrincipalBySlug: (
		slug: Slug,
	) => Effect.Effect<Option.Option<PrincipalRow>, DatabaseError>;
	readonly findByEmail: (
		email: Email,
	) => Effect.Effect<Option.Option<PrincipalWithUser>, DatabaseError>;
	readonly findUserByUserId: (
		id: UserId,
	) => Effect.Effect<Option.Option<UserRow>, DatabaseError>;
	/** Update dead properties and/or displayName on the principal row. */
	readonly updateProperties: (
		id: PrincipalId,
		changes: PrincipalPropertyChanges,
	) => Effect.Effect<PrincipalRow, DatabaseError>;
	/** Return all non-deleted user principals (with user join). */
	readonly listAll: () => Effect.Effect<
		ReadonlyArray<PrincipalWithUser>,
		DatabaseError
	>;
	/**
	 * Search user principals whose displayName (case-insensitive substring)
	 * contains the given string.  Falls back to searching by email if no
	 * displayName is set.
	 */
	readonly searchByDisplayName: (
		query: string,
	) => Effect.Effect<ReadonlyArray<PrincipalWithUser>, DatabaseError>;
}

export class PrincipalRepository extends Context.Tag("PrincipalRepository")<
	PrincipalRepository,
	PrincipalRepositoryShape
>() {}
