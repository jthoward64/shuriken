import { Context, type Effect, type Option, type Redacted } from "effect";
import type { DatabaseError, InternalError } from "#src/domain/errors.ts";
import type { UserId, UuidString } from "#src/domain/ids.ts";
import type { AppPasswordRow } from "#src/services/app-password/repository.ts";

// ---------------------------------------------------------------------------
// AppPasswordService — generate / list / revoke per-device DAV credentials.
//
// `generate` mints a username + secret, stores only the argon2id hash, and
// returns the plaintext exactly once for the user to copy into their client.
// ---------------------------------------------------------------------------

export interface GeneratedAppPassword {
	/** The username the user enters in their DAV client. */
	readonly username: string;
	/** The plaintext secret — shown once, never recoverable afterwards. */
	readonly password: Redacted.Redacted<string>;
	readonly label: Option.Option<string>;
}

export interface AppPasswordServiceShape {
	readonly generate: (input: {
		readonly userId: UserId;
		readonly label: Option.Option<string>;
	}) => Effect.Effect<GeneratedAppPassword, DatabaseError | InternalError>;
	readonly list: (
		userId: UserId,
	) => Effect.Effect<ReadonlyArray<AppPasswordRow>, DatabaseError>;
	readonly revoke: (
		userId: UserId,
		id: UuidString,
	) => Effect.Effect<void, DatabaseError>;
}

export class AppPasswordService extends Context.Service<
	AppPasswordService,
	AppPasswordServiceShape
>()("AppPasswordService") {}
