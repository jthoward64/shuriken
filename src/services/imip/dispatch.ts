import type { Effect } from "effect";
import { Context } from "effect";
import type { IrComponent } from "#src/data/ir.ts";
import type { InternalError } from "#src/domain/errors.ts";
import type { UserId } from "#src/domain/ids.ts";
import type { ImipMethod } from "./build-message.ts";

// ---------------------------------------------------------------------------
// ImipDispatchService — fire-and-forget iMIP delivery for outbound events.
//
// Called from event-write handlers after the persistence transaction
// succeeds. Iterates the VEVENT's ATTENDEE properties; for each non-local
// address (one that doesn't match an existing user row), composes an iMIP
// message via `build-message.ts` and hands it to MailerService using the
// organizer's resolved SMTP profile.
//
// Local attendees are skipped — they already see the event via direct ACL
// share or via the (future) CalDAV scheduling inbox flow.
// ---------------------------------------------------------------------------

export interface ImipDispatchInput {
	readonly method: ImipMethod;
	readonly vevent: IrComponent;
	readonly organizerUserId: UserId;
	readonly organizerEmail: string;
	readonly organizerDisplayName: string | null;
}

export interface ImipDispatchOutcome {
	readonly sent: number;
	readonly skippedLocal: number;
	readonly skippedDisabled: number;
	readonly failed: number;
}

export interface ImipDispatchServiceShape {
	readonly dispatch: (
		input: ImipDispatchInput,
	) => Effect.Effect<ImipDispatchOutcome, InternalError>;
}

export class ImipDispatchService extends Context.Tag("ImipDispatchService")<
	ImipDispatchService,
	ImipDispatchServiceShape
>() {}
