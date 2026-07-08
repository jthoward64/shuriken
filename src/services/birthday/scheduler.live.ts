import { Duration, Effect, Layer, Random, Schedule } from "effect";
import { AppConfigService } from "#src/config.ts";
import { CollectionId, type PrincipalId } from "#src/domain/ids.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { BirthdayService } from "./service.ts";

// ---------------------------------------------------------------------------
// BirthdaySchedulerLayer — periodic safety-net regeneration.
//
// Even with a write-side hook on vCard PUT/DELETE (TODO), we keep this
// sweep as the source of truth: it catches any miss (process restart,
// queued vCards from before the feature shipped, manual DB edits) so a
// birthday is never silently absent. Tick is in the multi-hour range by
// default — see config.ts. To avoid a burst of DB/CPU load on instances
// with many principals, both the first sweep (startup) and each sweep's
// own work are spread out over time rather than firing all at once.
// ---------------------------------------------------------------------------

const chunk = <T>(items: ReadonlyArray<T>, size: number): Array<Array<T>> => {
	const out: Array<Array<T>> = [];
	for (let i = 0; i < items.length; i += size) {
		out.push(items.slice(i, i + size));
	}
	return out;
};

const regenerateOne =
	(birthdays: BirthdayService["Service"]) => (c: CollectionRow) =>
		birthdays
			.regenerate(c.ownerPrincipalId as PrincipalId, CollectionId(c.id))
			.pipe(
				Effect.catchCause((cause) =>
					Effect.logWarning("scheduler.birthday: regenerate failed", {
						collectionId: c.id,
						cause,
					}),
				),
			);

const tickAll = Effect.gen(function* () {
	const collRepo = yield* CollectionRepository;
	const birthdays = yield* BirthdayService;
	const config = yield* AppConfigService;

	const targets = yield* collRepo.listByAutoManagedKind("birthdays");
	if (targets.length === 0) {
		yield* Effect.logTrace("scheduler.birthday: nothing to sweep");
		return;
	}

	const batches = chunk(targets, config.birthday.concurrency);
	// Leave a buffer before the next tick so a slow sweep can't run into it.
	const nextTickBufferS = 60;
	const millisPerSecond = 1000;
	const spreadWindowMs =
		Math.min(
			config.birthday.sweepSpreadS,
			Math.max(config.birthday.schedulerTickS - nextTickBufferS, 0),
		) * millisPerSecond;
	const interBatchDelayMs =
		batches.length > 1 ? spreadWindowMs / (batches.length - 1) : 0;

	yield* Effect.logDebug("scheduler.birthday: sweeping", {
		count: targets.length,
		batches: batches.length,
		spreadWindowMs,
	});

	yield* Effect.forEach(
		batches,
		(batch, i) =>
			Effect.sleep(Duration.millis(i * interBatchDelayMs)).pipe(
				Effect.andThen(() =>
					Effect.forEach(batch, regenerateOne(birthdays), {
						concurrency: "unbounded",
						discard: true,
					}),
				),
			),
		{ concurrency: "unbounded", discard: true },
	);
});

export const BirthdaySchedulerLayer = Layer.effectDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfigService;
		const tick = config.birthday.schedulerTickS;
		const startupDelayS = yield* Random.nextIntBetween(
			0,
			config.birthday.startupJitterMaxS + 1,
		);
		yield* Effect.logInfo("scheduler.birthday: starting sweep fiber", {
			tickS: tick,
			startupDelayS,
		});
		yield* Effect.sleep(Duration.seconds(startupDelayS)).pipe(
			Effect.andThen(() =>
				tickAll.pipe(
					Effect.catchCause((cause) =>
						Effect.logError("scheduler.birthday: tick crashed", { cause }),
					),
					Effect.repeat(
						Schedule.jittered(Schedule.spaced(Duration.seconds(tick))),
					),
				),
			),
			Effect.forkScoped,
		);
	}),
);
