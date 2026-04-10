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
	 * Handles an outbox POST free-busy request (RFC 6638 §5).
	 * Aggregates free-busy information for the requested ATTENDEE list
	 * and returns the VCALENDAR text.
	 */
	readonly processOutboxPost: (opts: {
		actingPrincipalId: PrincipalId;
		doc: IrDocument;
	}) => Effect.Effect<string, DavError | DatabaseError>;
}

export class SchedulingService extends Context.Tag("SchedulingService")<
	SchedulingService,
	SchedulingServiceShape
>() {}
