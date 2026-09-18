import { Effect, Layer, Option } from "effect";
import type { InternalError } from "#src/domain/errors.ts";
import { parseEmail } from "#src/domain/types/strings.ts";
import {
	MailerService,
	type SendOutcome,
} from "#src/services/mailer/service.ts";
import { UserRepository } from "#src/services/user/repository.ts";
import { buildImipMessage, extractAttendeeAddresses } from "./build-message.ts";
import type { ImipDispatchInput, ImipDispatchOutcome } from "./dispatch.ts";
import { ImipDispatchService } from "./dispatch.ts";

// ---------------------------------------------------------------------------
// Live ImipDispatchService — see dispatch.ts.
//
// Local-attendee detection: any address that resolves to a registered user
// (by exact email match, case-insensitive) is treated as local and skipped.
// Future enhancement: also skip addresses whose domain matches a configured
// `localDomains` allow-list — useful for organizations whose users haven't
// all been provisioned yet but where mail to remote-only attendees should
// still go out.
// ---------------------------------------------------------------------------

/** A per-attendee contribution to the dispatch outcome counters */
const NOTHING: ImipDispatchOutcome = {
	sent: 0,
	skippedLocal: 0,
	skippedDisabled: 0,
	failed: 0,
};
const SKIPPED_LOCAL: ImipDispatchOutcome = { ...NOTHING, skippedLocal: 1 };
const SKIPPED_DISABLED: ImipDispatchOutcome = {
	...NOTHING,
	skippedDisabled: 1,
};

/** Sum two dispatch outcomes */
const addOutcome = (
	a: ImipDispatchOutcome,
	b: ImipDispatchOutcome,
): ImipDispatchOutcome => ({
	sent: a.sent + b.sent,
	skippedLocal: a.skippedLocal + b.skippedLocal,
	skippedDisabled: a.skippedDisabled + b.skippedDisabled,
	failed: a.failed + b.failed,
});

/** Log a failed iMIP send and report it as nothing delivered */
const logSendFailure = Effect.fn("imip.dispatch.logSendFailure")(function* (
	to: string,
	cause: unknown,
) {
	yield* Effect.logWarning("imip.dispatch: send failed", { to, cause });
	return Option.none<SendOutcome>();
});

/** True when the address belongs to a user on this server */
const isLocalAttendee = Effect.fn("imip.dispatch.isLocalAttendee")(function* (
	address: string,
) {
	const userRepo = yield* UserRepository;
	const found = yield* userRepo
		.findByEmail(parseEmail(address))
		.pipe(Effect.orElseSucceed(() => Option.none()));
	return Option.isSome(found);
});

/** Compose and send one attendee's iMIP copy, reporting it as an outcome delta */
const dispatchToAttendee = Effect.fn("imip.dispatch.toAttendee")(function* (
	input: ImipDispatchInput,
	recipient: string,
) {
	if (yield* isLocalAttendee(recipient.toLowerCase())) {
		return SKIPPED_LOCAL;
	}
	const mailer = yield* MailerService;
	const message = yield* buildImipMessage({
		method: input.method,
		vevent: input.vevent,
		to: [recipient],
		...(input.zone !== undefined ? { zone: input.zone } : {}),
		...(input.vtimezone !== undefined ? { vtimezone: input.vtimezone } : {}),
	});
	// A `None` here is either mail disabled (a null outcome) or a send failure
	// that logSendFailure already reported; both count as skipped-disabled.
	const outcome = yield* mailer
		.sendForUser(
			input.organizerUserId,
			input.organizerEmail,
			input.organizerDisplayName,
			message,
		)
		.pipe(
			Effect.map(Option.fromNullishOr),
			Effect.catch((cause) => logSendFailure(recipient, cause)),
		);
	return Option.match(outcome, {
		onNone: () => SKIPPED_DISABLED,
		onSome: (sendOutcome) => ({
			...NOTHING,
			sent: sendOutcome.accepted.length,
			failed: sendOutcome.rejected.length,
		}),
	});
});

const dispatch = (
	input: ImipDispatchInput,
): Effect.Effect<
	ImipDispatchOutcome,
	InternalError,
	MailerService | UserRepository
> =>
	Effect.gen(function* () {
		const attendees =
			input.onlyRecipients ?? extractAttendeeAddresses(input.vevent);
		let totals = NOTHING;
		for (const raw of attendees) {
			// The organizer never receives their own invitation
			if (raw.toLowerCase() === input.organizerEmail.toLowerCase()) {
				totals = addOutcome(totals, SKIPPED_LOCAL);
				continue;
			}
			totals = addOutcome(totals, yield* dispatchToAttendee(input, raw));
		}
		return totals;
	});

export const ImipDispatchServiceLive = Layer.effect(
	ImipDispatchService,
	Effect.gen(function* () {
		const mailer = yield* MailerService;
		const userRepo = yield* UserRepository;
		return {
			dispatch: (input) =>
				dispatch(input).pipe(
					Effect.provideService(MailerService, mailer),
					Effect.provideService(UserRepository, userRepo),
				),
		};
	}),
);
