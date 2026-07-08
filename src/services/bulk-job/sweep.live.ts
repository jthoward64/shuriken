import { Duration, Effect, Layer, Schedule } from "effect";
import { Temporal } from "temporal-polyfill";
import { BulkJobRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// BulkJobSweepLayer — periodic sweep fiber (first tick fires immediately at
// layer startup, then every SWEEP_INTERVAL_MINUTES) that:
//
//  - fails any job still pending/running that's older than STALE_AFTER_HOURS.
//    `runChunkedJob` forks its worker with `Effect.forkDaemon`, which is not
//    tracked across a process restart, so an abandoned job would otherwise
//    stay "running" forever.
//  - clears the stored result blob (export/bulk-download .vcf bytes) once
//    past its blob_expires_at TTL, independent of whether it was downloaded.
// ---------------------------------------------------------------------------

const SWEEP_INTERVAL_MINUTES = 5;
const STALE_AFTER_HOURS = 1;

export const BulkJobSweepLayer = Layer.effectDiscard(
	Effect.gen(function* () {
		const jobRepo = yield* BulkJobRepository;

		const sweep = Effect.gen(function* () {
			const now = Temporal.Now.instant();
			yield* jobRepo.failStaleRunning(
				now.subtract(Temporal.Duration.from({ hours: STALE_AFTER_HOURS })),
			);
			const expired = yield* jobRepo.listExpiredBlobs(now);
			yield* Effect.forEach(expired, (job) => jobRepo.clearBlob(job.id), {
				discard: true,
			});
		});

		yield* Effect.logInfo("scheduler.bulk-job-sweep: starting sweep fiber", {
			intervalMinutes: SWEEP_INTERVAL_MINUTES,
			staleAfterHours: STALE_AFTER_HOURS,
		});
		yield* sweep.pipe(
			Effect.catchCause((cause) =>
				Effect.logWarning("scheduler.bulk-job-sweep: tick failed", { cause }),
			),
			Effect.repeat(Schedule.spaced(Duration.minutes(SWEEP_INTERVAL_MINUTES))),
			Effect.forkScoped,
		);
	}),
);
