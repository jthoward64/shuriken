import type { InferSelectModel } from "drizzle-orm";
import type { Context, Effect, Option } from "effect";
import { Context as Ctx } from "effect";
import type { Temporal } from "temporal-polyfill";
import type {
	externalCalendar,
	externalCalendarClaim,
	ExternalCalendarSyncStatus,
} from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId, UuidString } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// ExternalCalendarRepository — data access for shared subscription feeds and
// per-user claims. See `src/db/drizzle/schema/external-calendar.ts` for the
// table-level rationale.
// ---------------------------------------------------------------------------

export type ExternalCalendarRow = InferSelectModel<typeof externalCalendar>;
export type ExternalCalendarClaimRow = InferSelectModel<
	typeof externalCalendarClaim
>;

/** Patch fields recorded after each sync attempt. */
export interface SyncResultPatch {
	readonly lastSyncStatus: ExternalCalendarSyncStatus;
	readonly lastSyncAt: Temporal.Instant;
	/** Updated on successful HTTP fetch (2xx body); left unchanged on 304/errors. */
	readonly fetchedAt?: Temporal.Instant;
	readonly lastSyncError?: string | null;
	readonly httpEtag?: string | null;
	readonly httpLastModified?: string | null;
	readonly defaultDisplayname?: string | null;
	readonly defaultColor?: string | null;
}

export interface ExternalCalendarRepositoryShape {
	readonly findById: (
		id: UuidString,
	) => Effect.Effect<Option.Option<ExternalCalendarRow>, DatabaseError>;
	readonly findByUrl: (
		url: string,
	) => Effect.Effect<Option.Option<ExternalCalendarRow>, DatabaseError>;
	/**
	 * Atomically returns the existing row for `url` or inserts a new one. The
	 * caller's `syncIntervalS` is the initial value; subsequent claim changes
	 * may lower it via `recomputeSyncInterval`.
	 */
	readonly upsertByUrl: (input: {
		readonly url: string;
		readonly syncIntervalS: number;
	}) => Effect.Effect<ExternalCalendarRow, DatabaseError>;

	/** Soft-delete (set deleted_at) when the last claim is removed. */
	readonly softDelete: (id: UuidString) => Effect.Effect<void, DatabaseError>;

	/** Apply sync results. Does NOT touch sync_interval_s. */
	readonly recordSyncResult: (
		id: UuidString,
		patch: SyncResultPatch,
	) => Effect.Effect<void, DatabaseError>;

	/**
	 * Recompute `external_calendar.sync_interval_s` as the MIN of the row's
	 * non-deleted claims' `sync_interval_s`. Called after claim mutations.
	 * No-op when the row has no claims (callers should soft-delete in that case).
	 */
	readonly recomputeSyncInterval: (
		id: UuidString,
	) => Effect.Effect<void, DatabaseError>;

	/**
	 * Return active external_calendar rows whose next sync is due — i.e.
	 * `last_sync_at IS NULL OR last_sync_at + sync_interval_s < now()`. Used
	 * by the background scheduler.
	 */
	readonly findDue: (
		now: Temporal.Instant,
	) => Effect.Effect<ReadonlyArray<ExternalCalendarRow>, DatabaseError>;

	// --- Claims ---

	readonly findClaimById: (
		id: UuidString,
	) => Effect.Effect<Option.Option<ExternalCalendarClaimRow>, DatabaseError>;

	readonly findClaimByCollection: (
		collectionId: CollectionId,
	) => Effect.Effect<Option.Option<ExternalCalendarClaimRow>, DatabaseError>;

	readonly listClaimsForExternal: (
		externalCalendarId: UuidString,
	) => Effect.Effect<ReadonlyArray<ExternalCalendarClaimRow>, DatabaseError>;

	/** Joined view of every claim whose dav_collection is owned by this principal. */
	readonly listClaimsWithExternalForPrincipal: (
		principalId: PrincipalId,
	) => Effect.Effect<
		ReadonlyArray<{
			readonly claim: ExternalCalendarClaimRow;
			readonly external: ExternalCalendarRow;
		}>,
		DatabaseError
	>;

	readonly countClaimsForExternal: (
		externalCalendarId: UuidString,
	) => Effect.Effect<number, DatabaseError>;

	readonly insertClaim: (input: {
		readonly externalCalendarId: UuidString;
		readonly collectionId: CollectionId;
		readonly syncIntervalS: number;
		readonly colorOverride?: string;
		readonly displaynameOverride?: string;
	}) => Effect.Effect<ExternalCalendarClaimRow, DatabaseError>;

	/**
	 * Clear the cached HTTP conditional-GET validators (etag, last_modified)
	 * on the shared external_calendar row. Called when a new claim joins so
	 * the next scheduler tick performs an unconditional GET and populates the
	 * new claim's collection — otherwise a hit on the cached etag returns
	 * 304, the parsed body is never re-derived, and the new claim sees an
	 * empty calendar.
	 */
	readonly clearHttpCache: (
		id: UuidString,
	) => Effect.Effect<void, DatabaseError>;

	readonly updateClaim: (
		id: UuidString,
		patch: {
			readonly syncIntervalS?: number;
			readonly colorOverride?: string | null;
			readonly displaynameOverride?: string | null;
		},
	) => Effect.Effect<ExternalCalendarClaimRow, DatabaseError>;

	readonly deleteClaim: (
		id: UuidString,
	) => Effect.Effect<void, DatabaseError>;
}

export class ExternalCalendarRepository extends Ctx.Tag(
	"ExternalCalendarRepository",
)<ExternalCalendarRepository, ExternalCalendarRepositoryShape>() {}

// re-export for callers that prefer the Context.Tag name
export type ExternalCalendarRepositoryContext =
	Context.Tag.Identifier<typeof ExternalCalendarRepository>;
