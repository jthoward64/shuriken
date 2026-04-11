import type { Effect, Redacted } from "effect";
import { Context } from "effect";
import type {
	ConflictError,
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { Email } from "#src/domain/types/strings.ts";
import type { UserWithPrincipal } from "./repository.ts";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type NewCredential =
	| {
			readonly source: "local";
			readonly authId: string;
			readonly password: Redacted.Redacted<string>;
	  }
	| { readonly source: "proxy"; readonly authId: string };

export interface NewUser {
	readonly slug: Slug;
	readonly email: Email;
	readonly displayName?: string;
	readonly credentials?: ReadonlyArray<NewCredential>;
}

export interface UpdateUser {
	readonly displayName?: string;
	readonly email?: Email;
}

// ---------------------------------------------------------------------------
// UserService — business logic for user management
// ---------------------------------------------------------------------------

export interface UserServiceShape {
	readonly create: (
		input: NewUser,
	) => Effect.Effect<
		UserWithPrincipal,
		DavError | DatabaseError | ConflictError | InternalError
	>;
	readonly list: () => Effect.Effect<
		ReadonlyArray<UserWithPrincipal>,
		DatabaseError
	>;
	readonly findById: (
		id: UserId,
	) => Effect.Effect<UserWithPrincipal, DavError | DatabaseError>;
	readonly findBySlug: (
		slug: Slug,
	) => Effect.Effect<UserWithPrincipal, DavError | DatabaseError>;
	readonly update: (
		id: UserId,
		input: UpdateUser,
	) => Effect.Effect<UserWithPrincipal, DavError | DatabaseError>;
	readonly delete: (
		id: UserId,
	) => Effect.Effect<void, DavError | DatabaseError>;
	readonly addCredential: (
		userId: UserId,
		credential: NewCredential,
	) => Effect.Effect<void, DavError | DatabaseError | InternalError>;
	readonly removeCredential: (
		userId: UserId,
		authSource: string,
		authId: string,
	) => Effect.Effect<void, DavError | DatabaseError>;
	readonly setCredential: (
		userId: UserId,
		credential: NewCredential,
	) => Effect.Effect<void, DavError | DatabaseError | InternalError>;
}

export class UserService extends Context.Tag("UserService")<
	UserService,
	UserServiceShape
>() {}
