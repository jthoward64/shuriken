import type { Effect, Redacted } from "effect";
import { Context } from "effect";
import type { DatabaseError, DavError, InternalError } from "#src/domain/errors.ts";
import type { UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import type { Email } from "#src/domain/types/strings.ts";
import type { UserWithPrincipal } from "./repository.ts";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type NewCredential =
	| { readonly source: "local"; readonly authId: string; readonly password: Redacted.Redacted<string> }
	| { readonly source: "proxy"; readonly authId: string };

export interface NewUser {
	readonly slug: Slug;
	readonly name: string;
	readonly email: Email;
	readonly displayName?: string;
	readonly credentials?: ReadonlyArray<NewCredential>;
}

export interface UpdateUser {
	readonly name?: string;
	readonly email?: Email;
	readonly displayName?: string;
}

// ---------------------------------------------------------------------------
// UserService — business logic for user management
// ---------------------------------------------------------------------------

export interface UserServiceShape {
	readonly create: (
		input: NewUser,
	) => Effect.Effect<UserWithPrincipal, DavError | DatabaseError | InternalError>;
	readonly update: (
		id: UserId,
		input: UpdateUser,
	) => Effect.Effect<UserWithPrincipal, DavError | DatabaseError>;
	readonly addCredential: (
		userId: UserId,
		credential: NewCredential,
	) => Effect.Effect<void, DavError | DatabaseError | InternalError>;
	readonly removeCredential: (
		userId: UserId,
		authSource: string,
		authId: string,
	) => Effect.Effect<void, DavError | DatabaseError>;
}

export class UserService extends Context.Tag("UserService")<
	UserService,
	UserServiceShape
>() {}
