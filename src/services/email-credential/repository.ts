import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type {
	SmtpSecurity,
	userEmailCredential,
} from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { UserId } from "#src/domain/ids.ts";

export type UserEmailCredentialRow = InferSelectModel<
	typeof userEmailCredential
>;

export interface NewUserEmailCredential {
	readonly userId: UserId;
	readonly fromAddress: string;
	readonly fromName?: string;
	readonly host: string;
	readonly port: number;
	readonly username: string;
	readonly passwordEncrypted: string;
	readonly passwordIv: string;
	readonly security: SmtpSecurity;
}

export interface UserEmailCredentialRepositoryShape {
	readonly findByUserId: (
		userId: UserId,
	) => Effect.Effect<Option.Option<UserEmailCredentialRow>, DatabaseError>;
	/** Insert-or-update. There's at most one row per user (unique index). */
	readonly upsert: (
		input: NewUserEmailCredential,
	) => Effect.Effect<UserEmailCredentialRow, DatabaseError>;
	readonly delete: (userId: UserId) => Effect.Effect<void, DatabaseError>;
}

export class UserEmailCredentialRepository extends Context.Tag(
	"UserEmailCredentialRepository",
)<UserEmailCredentialRepository, UserEmailCredentialRepositoryShape>() {}
