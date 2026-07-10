import type { Effect } from "effect";
import { Context } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";

// ---------------------------------------------------------------------------
// ImipInboundService — parse a raw RFC 822 message containing an iMIP
// attachment and apply it to the recipient's calendar(s). LMTP and any
// future HTTP receiver share this entry point, so the transport layer
// stays a thin shell.
//
// Recipient resolution is "address must equal an existing user.email,
// case-insensitive". Anything else returns `unknownRecipient` and the
// caller (LMTP) reports a 550.
//
// Sender authentication (RFC 6047 has no signing mandate, but forging a
// CANCEL/REQUEST is trivial otherwise): when a message targets an existing
// UID, its ORGANIZER and the recipient's ATTENDEE membership are checked
// against the stored event whenever that event actually records them —
// `SenderNotAuthorized` otherwise. Events with no recorded ORGANIZER/ATTENDEE
// (e.g. created locally without scheduling) can't be checked this way and are
// left as before.
// ---------------------------------------------------------------------------

export type ImipInboundOutcome =
	| {
			readonly _tag: "Applied";
			readonly method: string;
			readonly recipientEmail: string;
			readonly uid: string;
	  }
	| {
			readonly _tag: "UnknownRecipient";
			readonly recipientEmail: string;
	  }
	| {
			readonly _tag: "MissingCalendar";
			readonly recipientEmail: string;
	  }
	| {
			readonly _tag: "NotImip";
	  }
	| {
			readonly _tag: "MalformedIcs";
			readonly cause: string;
	  }
	| {
			readonly _tag: "SenderNotAuthorized";
			readonly recipientEmail: string;
			readonly uid: string;
	  };

export interface ImipInboundServiceShape {
	/**
	 * Process one RFC 822 message addressed to one specific recipient. The
	 * caller is responsible for de-duplicating in the multi-RCPT case.
	 */
	readonly process: (input: {
		readonly recipientEmail: string;
		readonly rawMessage: string;
	}) => Effect.Effect<
		ImipInboundOutcome,
		DatabaseError | DavError | InternalError
	>;
}

export class ImipInboundService extends Context.Service<
	ImipInboundService,
	ImipInboundServiceShape
>()("ImipInboundService") {}
