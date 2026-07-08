import type { RecurrenceFreq } from "#src/services/cal-edit/types.ts";

// ---------------------------------------------------------------------------
// TaskFormData — UI fields for a VTODO (task/reminder) form. `build-vtodo.ts`
// converts to an IrComponent VTODO; `parse-vtodo.ts` does the inverse for
// pre-populating the edit page. Round-trip is lossy for properties not listed
// here (ATTACH, ATTENDEE, ALARM, …) — those are preserved on edit by
// `service.live.ts` merging unknown properties from the existing tree.
// ---------------------------------------------------------------------------

export type TaskStatus =
	| ""
	| "NEEDS-ACTION"
	| "IN-PROCESS"
	| "COMPLETED"
	| "CANCELLED";

export interface TaskFormData {
	readonly summary: string;
	readonly description: string;
	readonly location: string;
	readonly categoriesCsv: string;
	/** When true, DTSTART/DUE are date-only (VALUE=DATE). */
	readonly allDay: boolean;
	/** Optional — a VTODO may have no DTSTART. Same ISO form as EventFormData. */
	readonly start: string;
	/** Optional deadline. Empty string = no DUE. */
	readonly due: string;
	readonly status: TaskStatus;
	/** Optional 0-9 (RFC 5545 §3.8.1.9); empty string = unset. */
	readonly priority: string;
	/** Optional 0-100; empty string = unset. */
	readonly percentComplete: string;
	/** Empty string = no recurrence. */
	readonly recurrenceFreq: RecurrenceFreq;
	/** Optional positive integer; empty string = unbounded. */
	readonly recurrenceCount: string;
	/** Optional ISO date; empty string = unbounded. */
	readonly recurrenceUntil: string;
}

export const emptyTaskForm: TaskFormData = {
	summary: "",
	description: "",
	location: "",
	categoriesCsv: "",
	allDay: false,
	start: "",
	due: "",
	status: "",
	priority: "",
	percentComplete: "",
	recurrenceFreq: "",
	recurrenceCount: "",
	recurrenceUntil: "",
};
