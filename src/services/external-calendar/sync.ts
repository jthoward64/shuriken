import type { Effect } from "effect";
import { Context } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { UuidString } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// ExternalCalendarSyncService — one-shot fetch + parse + per-claim upsert.
//
// `syncOne(id)` is what the background scheduler calls. It always records a
// `last_sync_at` + status on the external_calendar row (success even on a
// 304 not-modified, failure on network / parse / upsert errors). On a 200
// it parses the iCalendar body and reconciles each claim's local collection
// with the parsed event set.
// ---------------------------------------------------------------------------

export interface ExternalCalendarSyncServiceShape {
	readonly syncOne: (
		id: UuidString,
	) => Effect.Effect<void, DatabaseError | DavError | InternalError>;
}

export class ExternalCalendarSyncService extends Context.Tag(
	"ExternalCalendarSyncService",
)<ExternalCalendarSyncService, ExternalCalendarSyncServiceShape>() {}
