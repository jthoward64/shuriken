// ---------------------------------------------------------------------------
// EventFormData — UI fields for a calendar event form. `build-vevent.ts`
// converts to an IrComponent VEVENT; `parse-vevent.ts` does the inverse for
// pre-populating the edit page. Round-trip is lossy for properties not
// listed here (ATTENDEE, ORGANIZER, ALARM, …) — those are preserved on edit
// by `service.live.ts` merging unknown properties from the existing tree.
// ---------------------------------------------------------------------------

export type RecurrenceFreq = "" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface EventFormData {
	readonly summary: string;
	readonly description: string;
	readonly location: string;
	readonly categoriesCsv: string;
	/** When true, DTSTART/DTEND are date-only (VALUE=DATE). */
	readonly allDay: boolean;
	/**
	 * ISO 8601 — `YYYY-MM-DD` when allDay, otherwise `YYYY-MM-DDTHH:mm`
	 * (local time, no timezone suffix; consumers attach VTIMEZONE / Z).
	 */
	readonly start: string;
	readonly end: string;
	/** Empty string = no recurrence. */
	readonly recurrenceFreq: RecurrenceFreq;
	/** Optional positive integer; empty string = unbounded. */
	readonly recurrenceCount: string;
	/** Optional ISO date; empty string = unbounded. */
	readonly recurrenceUntil: string;
}

export const emptyEventForm: EventFormData = {
	summary: "",
	description: "",
	location: "",
	categoriesCsv: "",
	allDay: false,
	start: "",
	end: "",
	recurrenceFreq: "",
	recurrenceCount: "",
	recurrenceUntil: "",
};
