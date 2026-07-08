import type { Effect } from "effect";
import { Context } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { CollectionId, EntityId, InstanceId } from "#src/domain/ids.ts";
import type { TaskFormData } from "./types.ts";

// ---------------------------------------------------------------------------
// TaskEditService — UI-side wrapper around VTODO create/update/delete.
//
// Counterpart to CalEditService (events) and CardEditService (contacts) for
// tasks. Owns UID generation, building the VTODO IR + wrapping it in a
// single-component VCALENDAR, and persisting via Entity + Component +
// InstanceService.
// ---------------------------------------------------------------------------

export interface TaskEditResult {
	readonly entityId: EntityId;
	readonly instanceId: InstanceId;
	readonly slug: string;
	readonly uid: string;
}

export interface TaskEditServiceShape {
	readonly create: (
		calendarId: CollectionId,
		form: TaskFormData,
	) => Effect.Effect<TaskEditResult, DatabaseError | DavError | InternalError>;
	readonly update: (
		instanceId: InstanceId,
		form: TaskFormData,
	) => Effect.Effect<TaskEditResult, DatabaseError | DavError | InternalError>;
	readonly delete: (
		instanceId: InstanceId,
	) => Effect.Effect<void, DatabaseError | DavError | InternalError>;
}

export class TaskEditService extends Context.Service<
	TaskEditService,
	TaskEditServiceShape
>()("TaskEditService") {}
