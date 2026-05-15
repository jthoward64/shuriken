import type { Effect } from "effect";
import { Context } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { CollectionId, EntityId, InstanceId } from "#src/domain/ids.ts";
import type { EventFormData } from "./types.ts";

// ---------------------------------------------------------------------------
// CalEditService — UI-side wrapper around event create/update/delete.
//
// Counterpart to CardEditService for calendar events. Owns UID generation,
// building the VEVENT IR + wrapping it in a single-event VCALENDAR, and
// persisting via Entity + Component + InstanceService.
// ---------------------------------------------------------------------------

export interface CalEditResult {
	readonly entityId: EntityId;
	readonly instanceId: InstanceId;
	readonly slug: string;
	readonly uid: string;
}

export interface CalEditServiceShape {
	readonly create: (
		calendarId: CollectionId,
		form: EventFormData,
		/**
		 * Optional pre-supplied UID — when set, that value is used as the
		 * VEVENT UID + entity logical_uid so the caller can correlate later
		 * (inbound iMIP REQUEST passes the sender's UID through). Defaults
		 * to a freshly minted UID.
		 */
		uid?: string,
	) => Effect.Effect<CalEditResult, DatabaseError | DavError | InternalError>;
	readonly update: (
		instanceId: InstanceId,
		form: EventFormData,
	) => Effect.Effect<CalEditResult, DatabaseError | DavError | InternalError>;
	readonly delete: (
		instanceId: InstanceId,
	) => Effect.Effect<void, DatabaseError | DavError | InternalError>;
}

export class CalEditService extends Context.Tag("CalEditService")<
	CalEditService,
	CalEditServiceShape
>() {}
