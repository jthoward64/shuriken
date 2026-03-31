// ---------------------------------------------------------------------------
// CalDAV / iCalendar types
// ---------------------------------------------------------------------------

/** iCalendar component types (RFC 5545) */
export type CalendarComponentType =
	| "VEVENT"
	| "VTODO"
	| "VJOURNAL"
	| "VFREEBUSY"
	| "VTIMEZONE"
	| "VALARM";

/** iCalendar top-level property types that may be indexed */
export type IndexedCalendarComponentType =
	| "VEVENT"
	| "VTODO"
	| "VJOURNAL"
	| "VFREEBUSY";

/** iTIP method values (RFC 5546) */
export type CalendarMethod =
	| "PUBLISH"
	| "REQUEST"
	| "REPLY"
	| "ADD"
	| "CANCEL"
	| "REFRESH"
	| "COUNTER"
	| "DECLINECOUNTER";

/** Recurrence rule frequency values (RFC 5545 §3.3.10) */
export type RecurrenceFrequency =
	| "SECONDLY"
	| "MINUTELY"
	| "HOURLY"
	| "DAILY"
	| "WEEKLY"
	| "MONTHLY"
	| "YEARLY";

/** CalDAV content type as returned in content-type headers */
export type CalendarContentType =
	| "text/calendar"
	| "text/calendar; charset=utf-8";
