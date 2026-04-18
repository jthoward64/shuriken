// ---------------------------------------------------------------------------
// Scheduling types — RFC 6638 (CalDAV Scheduling Extensions)
// ---------------------------------------------------------------------------

import type { InferSelectModel } from "drizzle-orm";
import type {
	davScheduleMessage,
	ScheduleMethod,
} from "#src/db/drizzle/schema/index.ts";
import type { CollectionId, EntityId, PrincipalId } from "#src/domain/ids.ts";

export type ScheduleMessageRow = InferSelectModel<typeof davScheduleMessage>;

// ---------------------------------------------------------------------------
// SchedulingRole — the role the acting principal plays in the event
// ---------------------------------------------------------------------------

export type SchedulingRole = "organizer" | "attendee" | "unrelated";

// ---------------------------------------------------------------------------
// AttendeeInfo — parsed attendee entry from an iTIP component
// ---------------------------------------------------------------------------

export interface AttendeeInfo {
	readonly calAddress: string; // full "mailto:..." URI
	readonly scheduleAgent: "SERVER" | "CLIENT" | "NONE";
	readonly rsvp: boolean;
	readonly partstat: string;
}

// ---------------------------------------------------------------------------
// NewScheduleMessage — input for inserting a dav_schedule_message row
// ---------------------------------------------------------------------------

export interface NewScheduleMessage {
	readonly collectionId: CollectionId; // inbox collection id
	readonly entityId: EntityId; // source SOR entity — for iMIP reconstruction
	readonly sender: string; // organizer cal-address
	readonly recipient: string; // external attendee cal-address
	readonly method: ScheduleMethod;
	readonly principalId?: PrincipalId; // acting principal (for audit)
}
