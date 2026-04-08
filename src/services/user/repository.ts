import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option, Redacted } from "effect";
import { Context } from "effect";
import type {
	authUser,
	principal,
	user,
} from "#src/db/drizzle/schema/index.ts";
import type { ConflictError, DatabaseError } from "#src/domain/errors.ts";
import type { UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { Email } from "#src/domain/types/strings.ts";

// ---------------------------------------------------------------------------
// UserRepository — data access for user + principal + auth_user rows
// ---------------------------------------------------------------------------

export type PrincipalRow = InferSelectModel<typeof principal>;
export type UserRow = InferSelectModel<typeof user>;
export type AuthUserRow = InferSelectModel<typeof authUser>;

export interface UserWithPrincipal {
	readonly principal: PrincipalRow;
	readonly user: UserRow;
}

export interface HashedCredential {
	readonly authSource: string;
	readonly authId: string;
	readonly authCredential: Option.Option<Redacted.Redacted<string>>;
}

export interface UserRepositoryShape {
	readonly findById: (
		id: UserId,
	) => Effect.Effect<Option.Option<UserWithPrincipal>, DatabaseError>;
	readonly findBySlug: (
		slug: Slug,
	) => Effect.Effect<Option.Option<UserWithPrincipal>, DatabaseError>;
	readonly findByEmail: (
		email: Email,
	) => Effect.Effect<Option.Option<UserWithPrincipal>, DatabaseError>;
	readonly list: () => Effect.Effect<
		ReadonlyArray<UserWithPrincipal>,
		DatabaseError
	>;
	readonly softDelete: (id: UserId) => Effect.Effect<void, DatabaseError>;
	readonly create: (input: {
		readonly slug: Slug;
		readonly name: string;
		readonly email: Email;
		readonly displayName?: string;
		readonly credentials: ReadonlyArray<HashedCredential>;
	}) => Effect.Effect<UserWithPrincipal, DatabaseError | ConflictError>;
	readonly update: (
		id: UserId,
		input: {
			readonly name?: string;
			readonly email?: Email;
			readonly displayName?: string;
		},
	) => Effect.Effect<UserWithPrincipal, DatabaseError>;
	readonly findCredential: (
		authSource: string,
		authId: string,
	) => Effect.Effect<Option.Option<AuthUserRow>, DatabaseError>;
	readonly insertCredential: (input: {
		readonly userId: UserId;
		readonly authSource: string;
		readonly authId: string;
		readonly authCredential: Option.Option<Redacted.Redacted<string>>;
	}) => Effect.Effect<AuthUserRow, DatabaseError>;
	readonly deleteCredential: (
		userId: UserId,
		authSource: string,
		authId: string,
	) => Effect.Effect<void, DatabaseError>;
}

export class UserRepository extends Context.Tag("UserRepository")<
	UserRepository,
	UserRepositoryShape
>() {}
