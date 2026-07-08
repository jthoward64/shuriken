import { Cause, Effect } from "effect";
import type { Temporal } from "temporal-polyfill";
import type { BulkJobKind } from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import {
	BulkJobRepository,
	type BulkJobRepositoryShape,
	type BulkJobRow,
} from "./repository.ts";

// ---------------------------------------------------------------------------
// runChunkedJob — shared chunking/progress-tracking harness for all bulk
// contacts actions (import, export, bulk-delete, bulk-clear-photo,
// bulk-download).
//
// Creates the bulk_job row synchronously, then forks the actual chunked work
// as a daemon fiber (detached from the caller's scope/request) so it keeps
// running after the HTTP response returns or the client disconnects. Progress
// is persisted once per chunk, not per item, to keep job-row writes cheap.
//
// `perItem` reports {ok:false} for failures that should just be counted (e.g.
// "contact already deleted") without failing the whole batch; letting an
// error propagate through `perItem`'s effect (uncaught) aborts the whole job
// as failed — used for authorization denials, matching the non-chunked
// bulk-action handlers' existing "never silently ignore an ACL denial"
// semantics.
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 50;
const CONCURRENCY = 4;

const toChunks = <T>(
	items: ReadonlyArray<T>,
	size: number,
): ReadonlyArray<ReadonlyArray<T>> => {
	const chunks: Array<ReadonlyArray<T>> = [];
	for (let i = 0; i < items.length; i += size) {
		chunks.push(items.slice(i, i + size));
	}
	return chunks;
};

export interface BulkJobOutcome {
	readonly succeeded: number;
	readonly failed: number;
}

export interface BulkJobCompletionResult {
	readonly result?: unknown;
	readonly resultBlob?: Uint8Array;
	readonly resultFilename?: string;
	readonly blobExpiresAt?: Temporal.Instant;
}

export interface ChunkedJobSpec<Item, E, R> {
	readonly kind: BulkJobKind;
	readonly ownerPrincipalId: PrincipalId;
	readonly collectionId?: CollectionId;
	readonly items: ReadonlyArray<Item>;
	readonly input: unknown;
	readonly perItem: (item: Item) => Effect.Effect<{ ok: boolean }, E, R>;
	readonly onDone: (
		outcome: BulkJobOutcome,
	) => Effect.Effect<BulkJobCompletionResult, never, R>;
}

const runWorker = <Item, E, R>(
	jobRepo: BulkJobRepositoryShape,
	row: BulkJobRow,
	spec: ChunkedJobSpec<Item, E, R>,
): Effect.Effect<void, never, R> =>
	Effect.gen(function* () {
		yield* jobRepo.markRunning(row.id);

		let done = 0;
		let succeeded = 0;
		let failed = 0;
		for (const items of toChunks(spec.items, CHUNK_SIZE)) {
			const results = yield* Effect.forEach(items, spec.perItem, {
				concurrency: CONCURRENCY,
			});
			for (const r of results) {
				done += 1;
				if (r.ok) {
					succeeded += 1;
				} else {
					failed += 1;
				}
			}
			yield* jobRepo.updateProgress(row.id, { done, succeeded, failed });
		}

		const completion = yield* spec.onDone({ succeeded, failed });
		yield* jobRepo.complete(row.id, completion);
	}).pipe(
		Effect.asVoid,
		Effect.catchCause((cause) =>
			jobRepo.fail(row.id, Cause.pretty(cause)).pipe(
				Effect.andThen(
					Effect.logWarning("bulk-job.runChunkedJob: job failed", {
						jobId: row.id,
						kind: spec.kind,
						cause,
					}),
				),
				Effect.orDie,
			),
		),
	);

export const runChunkedJob = <Item, E, R>(
	spec: ChunkedJobSpec<Item, E, R>,
): Effect.Effect<BulkJobRow, DatabaseError, BulkJobRepository | R> =>
	Effect.gen(function* () {
		const jobRepo = yield* BulkJobRepository;
		const row = yield* jobRepo.create({
			ownerPrincipalId: spec.ownerPrincipalId,
			collectionId: spec.collectionId,
			kind: spec.kind,
			total: spec.items.length,
			input: spec.input,
		});

		yield* Effect.forkDetach(runWorker(jobRepo, row, spec));

		return row;
	});
