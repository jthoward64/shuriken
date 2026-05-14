import { Duration, Effect, Layer, Schedule } from "effect";
import { AppConfigService } from "#src/config.ts";
import { CollectionId, type PrincipalId } from "#src/domain/ids.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { BirthdayService } from "./service.ts";

// ---------------------------------------------------------------------------
// BirthdaySchedulerLayer — periodic safety-net regeneration.
//
// Even with a write-side hook on vCard PUT/DELETE (TODO), we keep this
// sweep as the source of truth: it catches any miss (process restart,
// queued vCards from before the feature shipped, manual DB edits) so a
// birthday is never silently absent. Tick is in the 10-minute range by
// default — see config.ts.
// ---------------------------------------------------------------------------

const tickAll = Effect.gen(function* () {
	const collRepo = yield* CollectionRepository;
	const birthdays = yield* BirthdayService;
	const config = yield* AppConfigService;

	const targets = yield* collRepo.listByAutoManagedKind("birthdays");
	if (targets.length === 0) {
		yield* Effect.logTrace("scheduler.birthday: nothing to sweep");
		return;
	}
	yield* Effect.logDebug("scheduler.birthday: sweeping", {
		count: targets.length,
	});
	yield* Effect.forEach(
		targets,
		(c) =>
			birthdays
				.regenerate(
					c.ownerPrincipalId as PrincipalId,
					CollectionId(c.id),
				)
				.pipe(
					Effect.catchAllCause((cause) =>
						Effect.logWarning("scheduler.birthday: regenerate failed", {
							collectionId: c.id,
							cause,
						}),
					),
				),
		{ concurrency: config.birthday.concurrency, discard: true },
	);
});

export const BirthdaySchedulerLayer = Layer.scopedDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfigService;
		const tick = config.birthday.schedulerTickS;
		yield* Effect.logInfo("scheduler.birthday: starting sweep fiber", {
			tickS: tick,
		});
		yield* tickAll.pipe(
			Effect.catchAllCause((cause) =>
				Effect.logError("scheduler.birthday: tick crashed", { cause }),
			),
			Effect.repeat(Schedule.spaced(Duration.seconds(tick))),
			Effect.forkScoped,
		);
	}),
);
