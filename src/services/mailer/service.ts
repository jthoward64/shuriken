import type { Effect } from "effect";
import { Context } from "effect";
import type { InternalError } from "#src/domain/errors.ts";
import type { UserId } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// MailerService — outbound email transport.
//
// Resolution flow:
//   * `sendForUser` resolves the user's SMTP creds via EmailCredentialService
//     (per-user → server-wide profile → default fallback) and dispatches the
//     message through nodemailer.
//   * `sendRaw` accepts an explicit profile — used by ad-hoc system mailers
//     (e.g. password reset emails not attributable to a user). Currently
//     unused but kept on the shape for future system mail.
//
// Bodies are RFC 5322 compliant. iMIP messages set `headers["Content-Type"]`
// to `text/calendar; method=…; charset=utf-8` and put the VCALENDAR text in
// `text` directly — see `services/imip/build-message.ts`.
// ---------------------------------------------------------------------------

export interface MailMessage {
	readonly to: ReadonlyArray<string>;
	readonly subject: string;
	/** Plain-text body; iMIP messages put VCALENDAR here. */
	readonly text: string;
	/** Optional structured `Content-Type` override (defaults to text/plain). */
	readonly contentType?: string;
	/** Optional extra headers (e.g. `Reply-To`). Header names are case-insensitive. */
	readonly extraHeaders?: Readonly<Record<string, string>>;
	/** Optional inline / multipart alternative HTML. */
	readonly html?: string;
}

export interface SendOutcome {
	readonly accepted: ReadonlyArray<string>;
	readonly rejected: ReadonlyArray<string>;
	readonly messageId: string | null;
}

export interface MailerServiceShape {
	/**
	 * Resolves the user's SMTP profile and sends the message. Returns
	 * `null` when mail is disabled (no transport available); callers can
	 * distinguish that from a hard failure (which raises InternalError).
	 */
	readonly sendForUser: (
		userId: UserId,
		userEmail: string,
		userDisplayName: string | null,
		message: MailMessage,
	) => Effect.Effect<SendOutcome | null, InternalError>;
}

export class MailerService extends Context.Tag("MailerService")<
	MailerService,
	MailerServiceShape
>() {}
