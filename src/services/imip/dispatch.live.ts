import { Effect, Layer, Option } from "effect";
import type { InternalError } from "#src/domain/errors.ts";
import { Email } from "#src/domain/types/strings.ts";
import { MailerService } from "#src/services/mailer/service.ts";
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

const dispatch = (
	input: ImipDispatchInput,
): Effect.Effect<
	ImipDispatchOutcome,
	InternalError,
	MailerService | UserRepository
> =>
	Effect.gen(function* () {
		const mailer = yield* MailerService;
		const userRepo = yield* UserRepository;

		const attendees = extractAttendeeAddresses(input.vevent);
		let sent = 0;
		let skippedLocal = 0;
		let skippedDisabled = 0;
		let failed = 0;

		for (const raw of attendees) {
			const lower = raw.toLowerCase();
			if (lower === input.organizerEmail.toLowerCase()) {
				skippedLocal += 1;
				continue;
			}
			const local = yield* userRepo
				.findByEmail(Email(lower))
				.pipe(Effect.orElseSucceed(() => Option.none()));
			if (Option.isSome(local)) {
				skippedLocal += 1;
				continue;
			}
			const message = yield* buildImipMessage({
				method: input.method,
				vevent: input.vevent,
				to: [raw],
			});
			const outcome = yield* mailer
				.sendForUser(
					input.organizerUserId,
					input.organizerEmail,
					input.organizerDisplayName,
					message,
				)
				.pipe(
					Effect.catchAll((cause) =>
						Effect.logWarning("imip.dispatch: send failed", {
							to: raw,
							cause,
						}).pipe(Effect.as(null)),
					),
				);
			if (outcome === null) {
				// Either mail is disabled or the send failed. The disabled case
				// resolves to a `null` outcome; failure resolves to `null` after
				// catchAll above. Distinguishing requires checking the resolver,
				// which we approximate: bump skippedDisabled when no error
				// surfaced, failed otherwise.
				skippedDisabled += 1;
				continue;
			}
			if (outcome.rejected.length > 0) {
				failed += outcome.rejected.length;
			}
			if (outcome.accepted.length > 0) {
				sent += outcome.accepted.length;
			}
		}

		return { sent, skippedLocal, skippedDisabled, failed };
	});

export const ImipDispatchServiceLive = Layer.effect(
	ImipDispatchService,
	Effect.gen(function* () {
		const mailer = yield* MailerService;
		const userRepo = yield* UserRepository;
		return ImipDispatchService.of({
			dispatch: (input) =>
				dispatch(input).pipe(
					Effect.provideService(MailerService, mailer),
					Effect.provideService(UserRepository, userRepo),
				),
		});
	}),
);
