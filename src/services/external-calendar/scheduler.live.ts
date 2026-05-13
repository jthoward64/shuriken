import { Duration, Effect, Layer, Schedule } from "effect";
import { Temporal } from "temporal-polyfill";
import { AppConfigService } from "#src/config.ts";
import { ExternalCalendarRepository } from "./repository.ts";
import { ExternalCalendarSyncService } from "./sync.ts";

// ---------------------------------------------------------------------------
// ExternalCalendarSchedulerLayer — in-process polling fiber.
//
// Spawned at app boot, scoped to the runtime's lifetime. Every
// `schedulerTickS` seconds it asks `ExternalCalendarRepository.findDue` for
// rows whose `last_sync_at + sync_interval_s < now`, and then calls
// `ExternalCalendarSyncService.syncOne` for each (bounded parallelism).
//
// Per-row failures are recorded on the row itself by `syncOne`; the fiber
// never aborts on a single bad feed. If the fiber itself crashes (a defect
// in our code, not a sync error) we log and continue rather than tearing
// down the server.
// ---------------------------------------------------------------------------

const tickAll = Effect.gen(function* () {
	const repo = yield* ExternalCalendarRepository;
	const sync = yield* ExternalCalendarSyncService;
	const config = yield* AppConfigService;
	const now = Temporal.Now.instant();
	const due = yield* repo.findDue(now);
	if (due.length === 0) {
		yield* Effect.logTrace("scheduler.external: nothing due");
		return;
	}
	yield* Effect.logDebug("scheduler.external: fetching due rows", {
		count: due.length,
	});
	yield* Effect.forEach(due, (row) => sync.syncOne(row.id), {
		concurrency: config.externalCalendar.fetchConcurrency,
		discard: true,
	});
});

export const ExternalCalendarSchedulerLayer = Layer.scopedDiscard(
	Effect.gen(function* () {
		const config = yield* AppConfigService;
		const tick = config.externalCalendar.schedulerTickS;
		yield* Effect.logInfo(
			"scheduler.external: starting polling fiber",
			{ tickS: tick },
		);
		yield* tickAll.pipe(
			// `catchAllCause` keeps the fiber alive across defects too — a
			// rogue exception in one tick mustn't kill the whole scheduler.
			Effect.catchAllCause((cause) =>
				Effect.logError("scheduler.external: tick failed", { cause }),
			),
			Effect.repeat(Schedule.spaced(Duration.seconds(tick))),
			Effect.forkScoped,
		);
	}),
);
