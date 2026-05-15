import type { Effect, Redacted } from "effect";
import { Context } from "effect";
import type { SmtpSecurity } from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError, InternalError } from "#src/domain/errors.ts";
import type { UserId } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// EmailCredentialService — resolves "which SMTP creds should I use to send
// mail on behalf of this user" into a concrete connection profile.
//
// Priority chain:
//   1. user — explicit per-user creds in user_email_credential. Sends as
//      whatever from-address the user configured (typically their own).
//   2. profile — server-wide regex-scoped profile matching the user's
//      registered email. Sends AS the user's address; the relay is
//      expected to permit it (admin-trusted setup).
//   3. default — global fallback relay. From: SMTP_FROM, with
//      Reply-To: <user.email> so replies still reach the user.
//
// `kind` makes the chosen layer observable so the mailer transport can log
// it and so #6 (iMIP) can pick the right Reply-To behavior.
// ---------------------------------------------------------------------------

export type ResolvedKind = "user" | "user-proxy" | "profile" | "default";

export interface ResolvedSmtpCreds {
	readonly kind: ResolvedKind;
	readonly host: string;
	readonly port: number;
	readonly username: string;
	readonly password: Redacted.Redacted<string>;
	readonly security: SmtpSecurity;
	/** Address to put in `From:`. */
	readonly fromAddress: string;
	readonly fromName: string | null;
	/**
	 * Address to put in `Reply-To:`. `null` when no Reply-To override is
	 * needed (user-explicit and profile-matched layers both send AS the
	 * user, so replies already go to the right place).
	 */
	readonly replyTo: string | null;
}

export interface EmailCredentialServiceShape {
	/** Returns null when mail is disabled or no usable creds resolve. */
	readonly resolveForUser: (
		userId: UserId,
		userEmail: string,
		userDisplayName: string | null,
	) => Effect.Effect<ResolvedSmtpCreds | null, DatabaseError | InternalError>;
	/**
	 * Persist per-user creds, encrypting the password with EMAIL_CREDS_KEY.
	 * Returns InternalError if the env key is unset.
	 */
	readonly storeForUser: (input: {
		readonly userId: UserId;
		readonly fromAddress: string;
		readonly fromName?: string;
		readonly host: string;
		readonly port: number;
		readonly username: string;
		readonly password: Redacted.Redacted<string>;
		readonly security: SmtpSecurity;
	}) => Effect.Effect<void, DatabaseError | InternalError>;
	readonly clearForUser: (userId: UserId) => Effect.Effect<void, DatabaseError>;
}

export class EmailCredentialService extends Context.Tag(
	"EmailCredentialService",
)<EmailCredentialService, EmailCredentialServiceShape>() {}
