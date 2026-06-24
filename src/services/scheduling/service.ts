// ---------------------------------------------------------------------------
// SchedulingService — RFC 6638 scheduling logic interface
// ---------------------------------------------------------------------------

import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { IrDocument } from "#src/data/ir.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import type {
	CollectionId,
	EntityId,
	InstanceId,
	PrincipalId,
} from "#src/domain/ids.ts";

export interface SchedulingServiceShape {
	/**
	 * Called after a successful PUT to detect and process scheduling.
	 *
	 * Returns `Option.some(scheduleTag)` if the resource is a SOR (scheduling
	 * object resource), `Option.none()` otherwise.
	 *
	 * Side effects: delivers iTIP REQUEST/REPLY messages, inserts pending
	 * dav_schedule_message rows for external attendees, updates SCHEDULE-STATUS
	 * on ATTENDEE properties in the stored component tree.
	 */
	readonly processAfterPut: (opts: {
		actingPrincipalId: PrincipalId;
		entityId: EntityId;
		instanceId: InstanceId;
		collectionId: CollectionId;
		doc: IrDocument;
		previousDoc: Option.Option<IrDocument>;
		/**
		 * The Schedule-Tag currently stored on the resource (RFC 6638 §3.2.10).
		 * `Option.none()` for a create. Used to keep the tag stable across an
		 * attendee's PARTSTAT-only update.
		 */
		previousScheduleTag: Option.Option<string>;
		suppressReply: boolean;
	}) => Effect.Effect<Option.Option<string>, DavError | DatabaseError>;

	/**
	 * Called before a PUT update to validate scheduling change rules.
	 * Enforces RFC 6638 §3.2.2 attendee-only-allowed change restrictions.
	 * Fails with `DavError` if the change is not allowed.
	 */
	readonly validateSchedulingChange: (opts: {
		actingPrincipalId: PrincipalId;
		oldDoc: IrDocument;
		newDoc: IrDocument;
	}) => Effect.Effect<void, DavError | DatabaseError>;

	/**
	 * Called after a DELETE to send CANCEL (organizer) or REPLY DECLINED (attendee).
	 */
	readonly processAfterDelete: (opts: {
		actingPrincipalId: PrincipalId;
		doc: IrDocument;
		suppressReply: boolean;
	}) => Effect.Effect<void, DavError | DatabaseError>;

	/**
	 * Handles an outbox POST free-busy request (RFC 6638 §5 / §6.2). Computes
	 * free-busy for each requested ATTENDEE and returns one result per recipient
	 * so the edge can build a CALDAV:schedule-response (RFC 6638 §6.2.2, §10.2).
	 */
	readonly processOutboxPost: (opts: {
		actingPrincipalId: PrincipalId;
		doc: IrDocument;
	}) => Effect.Effect<
		ReadonlyArray<OutboxFreeBusyResult>,
		DavError | DatabaseError
	>;
}

/**
 * One per-recipient result of an outbox free-busy POST (RFC 6638 §6.2.2). When
 * `found` is false the recipient is not a calendar user the server can resolve
 * — the edge emits request-status `3.7` and no calendar data; otherwise `2.0`
 * with `calendarData` carrying that recipient's VFREEBUSY.
 */
export interface OutboxFreeBusyResult {
	readonly recipient: string;
	readonly found: boolean;
	readonly calendarData: string;
}

export class SchedulingService extends Context.Service<
	SchedulingService,
	SchedulingServiceShape
>()("SchedulingService") {}
