import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import { Effect, Layer, Option } from "effect";
import type { Temporal } from "temporal-polyfill";
import { DatabaseClient } from "#src/db/client.ts";
import { bulkJob } from "#src/db/drizzle/schema/index.ts";
import { runDbQuery } from "#src/db/query.ts";
import { DatabaseError } from "#src/domain/errors.ts";
import type { UuidString } from "#src/domain/ids.ts";
import {
	type BulkJobCompletion,
	type BulkJobProgress,
	BulkJobRepository,
	type NewBulkJob,
} from "./repository.ts";

// ---------------------------------------------------------------------------
// BulkJobRepository — Drizzle implementation
// ---------------------------------------------------------------------------

const create = Effect.fn("BulkJobRepository.create")(
	function* (input: NewBulkJob) {
		yield* Effect.annotateCurrentSpan({
			"bulk_job.kind": input.kind,
			"bulk_job.owner": input.ownerPrincipalId,
		});
		return yield* runDbQuery((db) =>
			db
				.insert(bulkJob)
				.values({
					ownerPrincipalId: input.ownerPrincipalId,
					collectionId: input.collectionId,
					kind: input.kind,
					total: input.total,
					input: input.input,
				})
				.returning(),
		).pipe(
			Effect.flatMap((rows) => {
				const row = rows[0];
				if (!row) {
					return Effect.fail(
						new DatabaseError({ cause: new Error("Insert returned no rows") }),
					);
				}
				return Effect.succeed(row);
			}),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.bulk-job.create failed", e.cause),
	),
);

const findById = Effect.fn("BulkJobRepository.findById")(
	function* (id: UuidString) {
		yield* Effect.annotateCurrentSpan({ "bulk_job.id": id });
		const rows = yield* runDbQuery((db) =>
			db.select().from(bulkJob).where(eq(bulkJob.id, id)),
		);
		return Option.fromNullishOr(rows[0]);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.bulk-job.findById failed", e.cause),
	),
);

const markRunning = Effect.fn("BulkJobRepository.markRunning")(
	function* (id: UuidString) {
		yield* Effect.annotateCurrentSpan({ "bulk_job.id": id });
		return yield* runDbQuery((db) =>
			db
				.update(bulkJob)
				.set({ status: "running", updatedAt: sql`now()` })
				.where(eq(bulkJob.id, id)),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.bulk-job.markRunning failed", e.cause),
	),
);

const updateProgress = Effect.fn("BulkJobRepository.updateProgress")(
	function* (id: UuidString, progress: BulkJobProgress) {
		yield* Effect.annotateCurrentSpan({ "bulk_job.id": id });
		return yield* runDbQuery((db) =>
			db
				.update(bulkJob)
				.set({
					done: progress.done,
					succeeded: progress.succeeded,
					failed: progress.failed,
					updatedAt: sql`now()`,
				})
				.where(eq(bulkJob.id, id)),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.bulk-job.updateProgress failed", e.cause),
	),
);

const complete = Effect.fn("BulkJobRepository.complete")(
	function* (id: UuidString, completion: BulkJobCompletion) {
		yield* Effect.annotateCurrentSpan({ "bulk_job.id": id });
		return yield* runDbQuery((db) =>
			db
				.update(bulkJob)
				.set({
					status: "succeeded",
					result: completion.result ?? null,
					resultBlob: completion.resultBlob
						? Buffer.from(completion.resultBlob)
						: null,
					resultFilename: completion.resultFilename ?? null,
					blobExpiresAt: completion.blobExpiresAt,
					updatedAt: sql`now()`,
				})
				.where(eq(bulkJob.id, id)),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.bulk-job.complete failed", e.cause),
	),
);

const fail = Effect.fn("BulkJobRepository.fail")(
	function* (id: UuidString, message: string) {
		yield* Effect.annotateCurrentSpan({ "bulk_job.id": id });
		return yield* runDbQuery((db) =>
			db
				.update(bulkJob)
				.set({ status: "failed", errorMessage: message, updatedAt: sql`now()` })
				.where(eq(bulkJob.id, id)),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.bulk-job.fail failed", e.cause),
	),
);

const clearBlob = Effect.fn("BulkJobRepository.clearBlob")(
	function* (id: UuidString) {
		yield* Effect.annotateCurrentSpan({ "bulk_job.id": id });
		return yield* runDbQuery((db) =>
			db
				.update(bulkJob)
				.set({ resultBlob: null, blobExpiresAt: null })
				.where(eq(bulkJob.id, id)),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.bulk-job.clearBlob failed", e.cause),
	),
);

const listExpiredBlobs = Effect.fn("BulkJobRepository.listExpiredBlobs")(
	function* (now: Temporal.Instant) {
		return yield* runDbQuery((db) =>
			db
				.select()
				.from(bulkJob)
				.where(
					and(isNotNull(bulkJob.resultBlob), lte(bulkJob.blobExpiresAt, now)),
				),
		);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.bulk-job.listExpiredBlobs failed", e.cause),
	),
);

const failStaleRunning = Effect.fn("BulkJobRepository.failStaleRunning")(
	function* (cutoff: Temporal.Instant) {
		return yield* runDbQuery((db) =>
			db
				.update(bulkJob)
				.set({
					status: "failed",
					errorMessage: "interrupted by restart",
					updatedAt: sql`now()`,
				})
				.where(
					and(
						sql`${bulkJob.status} IN ('pending', 'running')`,
						lte(bulkJob.createdAt, cutoff),
					),
				),
		).pipe(Effect.asVoid);
	},
	Effect.tapError((e) =>
		Effect.logWarning("repo.bulk-job.failStaleRunning failed", e.cause),
	),
);

export const BulkJobRepositoryLive = Layer.effect(
	BulkJobRepository,
	Effect.gen(function* () {
		const dc = yield* DatabaseClient;
		const run = <A, E>(
			e: Effect.Effect<A, E, DatabaseClient>,
		): Effect.Effect<A, E> => Effect.provideService(e, DatabaseClient, dc);
		return {
			create: (...args: Parameters<typeof create>) => run(create(...args)),
			findById: (...args: Parameters<typeof findById>) =>
				run(findById(...args)),
			markRunning: (...args: Parameters<typeof markRunning>) =>
				run(markRunning(...args)),
			updateProgress: (...args: Parameters<typeof updateProgress>) =>
				run(updateProgress(...args)),
			complete: (...args: Parameters<typeof complete>) =>
				run(complete(...args)),
			fail: (...args: Parameters<typeof fail>) => run(fail(...args)),
			clearBlob: (...args: Parameters<typeof clearBlob>) =>
				run(clearBlob(...args)),
			listExpiredBlobs: (...args: Parameters<typeof listExpiredBlobs>) =>
				run(listExpiredBlobs(...args)),
			failStaleRunning: (...args: Parameters<typeof failStaleRunning>) =>
				run(failStaleRunning(...args)),
		};
	}),
);
