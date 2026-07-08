import { Context, type Effect, type Redacted } from "effect";
import type { Temporal } from "temporal-polyfill";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { UserId, UuidString } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// AppPasswordRepository — management view over auth_user rows whose
// authSource = "app_password". Verification of these credentials at login time
// lives in the Basic-auth path; this repository covers create / list / revoke
// for the profile UI.
// ---------------------------------------------------------------------------

export interface AppPasswordRow {
	readonly id: UuidString;
	/** The generated username the credential authenticates under. */
	readonly username: string;
	readonly label: string | null;
	readonly lastUsedAt: Temporal.Instant | null;
	readonly createdAt: Temporal.Instant;
}

export interface NewAppPassword {
	readonly userId: UserId;
	readonly username: string;
	readonly label: string | null;
	readonly authCredential: Redacted.Redacted<string>;
}

export interface AppPasswordRepositoryShape {
	readonly create: (
		input: NewAppPassword,
	) => Effect.Effect<void, DatabaseError>;
	readonly listByUser: (
		userId: UserId,
	) => Effect.Effect<ReadonlyArray<AppPasswordRow>, DatabaseError>;
	/** Delete one app password owned by `userId`; no-op if not theirs. */
	readonly deleteForUser: (
		userId: UserId,
		id: UuidString,
	) => Effect.Effect<void, DatabaseError>;
}

export class AppPasswordRepository extends Context.Service<
	AppPasswordRepository,
	AppPasswordRepositoryShape
>()("AppPasswordRepository") {}
