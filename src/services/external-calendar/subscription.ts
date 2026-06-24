import type { Effect } from "effect";
import { Context } from "effect";
import type {
	ConflictError,
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId, UuidString } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// SubscriptionService — orchestrates subscribe / update / unsubscribe across
// ExternalCalendarRepository + CollectionService so the UI handlers stay thin.
//
// `subscribe` is the only multi-step flow worth its own service tag:
//   1. Validate input.
//   2. Find-or-insert the shared external_calendar row.
//   3. Enforce claim cap (configurable).
//   4. Provision a local dav_collection for this user.
//   5. Insert the claim, recompute the parent's effective sync interval, and
//      clear HTTP cache so the next sync populates this claim's collection.
//
// Per-step failure cases are mapped to typed errors callers can render.
// ---------------------------------------------------------------------------

export interface SubscribeInput {
	readonly principalId: PrincipalId;
	/** Owner's principalId — used as the collection's `owner_principal_id`. */
	readonly url: string;
	readonly displaynameOverride?: string;
	readonly colorOverride?: string;
	readonly syncIntervalS: number;
	/** URL path segment for the new dav_collection. Validated via `isValidSlug`. */
	readonly slug: string;
}

export interface SubscribeResult {
	readonly externalCalendarId: UuidString;
	readonly claimId: UuidString;
	readonly collectionId: CollectionId;
}

export interface SubscriptionServiceShape {
	readonly subscribe: (
		input: SubscribeInput,
	) => Effect.Effect<
		SubscribeResult,
		DatabaseError | DavError | ConflictError | InternalError
	>;
	/** Delete the claim, GC the parent row when last claim leaves, recompute interval otherwise. */
	readonly unsubscribe: (
		claimId: UuidString,
	) => Effect.Effect<void, DatabaseError | DavError | InternalError>;
}

export class SubscriptionService extends Context.Service<
	SubscriptionService,
	SubscriptionServiceShape
>()("SubscriptionService") {}
