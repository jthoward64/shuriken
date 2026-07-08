import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { Temporal } from "temporal-polyfill";
import type { BulkJobKind, bulkJob } from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId, UuidString } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// BulkJobRepository — data access for bulk_job rows
//
// Tracks progress of chunked bulk operations (contacts import/export/bulk
// delete/clear-photo/download) so it survives the worker fiber outliving the
// request that started it, and so the SSE progress endpoint can be polled or
// reconnected to independently of the original request.
// ---------------------------------------------------------------------------

export type BulkJobRow = InferSelectModel<typeof bulkJob>;

export interface NewBulkJob {
	readonly ownerPrincipalId: PrincipalId;
	readonly collectionId?: CollectionId;
	readonly kind: BulkJobKind;
	readonly total: number;
	readonly input: unknown;
}

export interface BulkJobProgress {
	readonly done: number;
	readonly succeeded: number;
	readonly failed: number;
}

export interface BulkJobCompletion {
	readonly result?: unknown;
	readonly resultBlob?: Uint8Array;
	readonly resultFilename?: string;
	readonly blobExpiresAt?: Temporal.Instant;
}

export interface BulkJobRepositoryShape {
	readonly create: (
		input: NewBulkJob,
	) => Effect.Effect<BulkJobRow, DatabaseError>;
	readonly findById: (
		id: UuidString,
	) => Effect.Effect<Option.Option<BulkJobRow>, DatabaseError>;
	readonly markRunning: (id: UuidString) => Effect.Effect<void, DatabaseError>;
	readonly updateProgress: (
		id: UuidString,
		progress: BulkJobProgress,
	) => Effect.Effect<void, DatabaseError>;
	readonly complete: (
		id: UuidString,
		completion: BulkJobCompletion,
	) => Effect.Effect<void, DatabaseError>;
	readonly fail: (
		id: UuidString,
		message: string,
	) => Effect.Effect<void, DatabaseError>;
	/** Clears the stored result blob (download served, or evicted by the TTL sweep). */
	readonly clearBlob: (id: UuidString) => Effect.Effect<void, DatabaseError>;
	/** Every job whose blob_expires_at has passed — used by the periodic TTL sweep. */
	readonly listExpiredBlobs: (
		now: Temporal.Instant,
	) => Effect.Effect<ReadonlyArray<BulkJobRow>, DatabaseError>;
	/**
	 * Mark any job still pending/running as failed if older than `cutoff`. Used
	 * by the startup sweep to reconcile jobs abandoned by a process restart
	 * (their worker fiber, forked daemon-style, does not survive a restart).
	 */
	readonly failStaleRunning: (
		cutoff: Temporal.Instant,
	) => Effect.Effect<void, DatabaseError>;
}

export class BulkJobRepository extends Context.Service<
	BulkJobRepository,
	BulkJobRepositoryShape
>()("BulkJobRepository") {}
