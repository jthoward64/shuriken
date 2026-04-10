// ---------------------------------------------------------------------------
// SchedulingRepository — RFC 6638 data access
// ---------------------------------------------------------------------------

import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { IrComponent } from "#src/data/ir.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type {
	CollectionId,
	EntityId,
	InstanceId,
	PrincipalId,
} from "#src/domain/ids.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import type { PrincipalWithUser } from "#src/services/principal/repository.ts";
import type { NewScheduleMessage, ScheduleMessageRow } from "./types.ts";

// ---------------------------------------------------------------------------
// SchedulingRepository interface
// ---------------------------------------------------------------------------

export interface SchedulingRepositoryShape {
	/**
	 * Find a principal by their calendar address (e.g. "mailto:user@example.com").
	 * Strips the "mailto:" prefix and looks up by user email.
	 */
	readonly findPrincipalByCalAddress: (
		calAddress: string,
	) => Effect.Effect<Option.Option<PrincipalWithUser>, DatabaseError>;

	/** Find a principal's scheduling inbox collection. */
	readonly findInbox: (
		principalId: PrincipalId,
	) => Effect.Effect<Option.Option<CollectionRow>, DatabaseError>;

	/**
	 * Find the default calendar for auto-placement of incoming invitations.
	 * Returns the collection referenced by inbox.scheduleDefaultCalendarId.
	 */
	readonly findDefaultCalendar: (
		principalId: PrincipalId,
	) => Effect.Effect<Option.Option<CollectionRow>, DatabaseError>;

	/**
	 * Find the organizer's scheduling object resource (SOR) by UID across all
	 * calendar collections owned by the principal.
	 */
	readonly findSorByUid: (
		principalId: PrincipalId,
		uid: string,
	) => Effect.Effect<
		Option.Option<{ instance: InstanceRow; collection: CollectionRow }>,
		DatabaseError
	>;

	/**
	 * Find an existing inbox message for the given instance
	 * (used to check for duplicate deliveries).
	 */
	readonly findInboxInstance: (
		inboxCollectionId: CollectionId,
		uid: string,
	) => Effect.Effect<
		Option.Option<{
			instance: InstanceRow;
			entityId: EntityId;
			components: ReadonlyArray<IrComponent>;
		}>,
		DatabaseError
	>;

	/** Insert a pending schedule message (for iMIP pickup). */
	readonly insertScheduleMessage: (
		msg: NewScheduleMessage,
	) => Effect.Effect<ScheduleMessageRow, DatabaseError>;

	/** Update the schedule_tag on an instance row. */
	readonly updateScheduleTag: (
		instanceId: InstanceId,
		scheduleTag: string,
	) => Effect.Effect<void, DatabaseError>;

	/**
	 * List all non-deleted calendar collections for a principal where
	 * `schedule_transp = 'opaque'` (i.e. contributes to free-busy).
	 */
	readonly listOpaqueCalendarCollections: (
		principalId: PrincipalId,
	) => Effect.Effect<ReadonlyArray<CollectionRow>, DatabaseError>;
}

export class SchedulingRepository extends Context.Tag("SchedulingRepository")<
	SchedulingRepository,
	SchedulingRepositoryShape
>() {}
