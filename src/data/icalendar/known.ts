import type { IrValueType } from "../ir.ts";

// ---------------------------------------------------------------------------
// iCal property default-type lookup (RFC 5545 §3.8)
//
// Keys are the uppercase property names produced by ContentLinesCodec.
// Using a Map avoids naming-convention lint issues with ALL_CAPS/hyphenated keys.
// ---------------------------------------------------------------------------

export const ICAL_DEFAULT_TYPES = new Map<string, IrValueType>([
	// VCALENDAR
	["CALSCALE", "TEXT"],
	["METHOD", "TEXT"],
	["PRODID", "TEXT"],
	["VERSION", "TEXT"],
	// Descriptive
	["ATTACH", "URI"],
	["CATEGORIES", "TEXT_LIST"],
	["CLASS", "TEXT"],
	["COMMENT", "TEXT"],
	["DESCRIPTION", "TEXT"],
	["GEO", "TEXT"],
	["LOCATION", "TEXT"],
	["PERCENT-COMPLETE", "INTEGER"],
	["PRIORITY", "INTEGER"],
	["RESOURCES", "TEXT_LIST"],
	["STATUS", "TEXT"],
	["SUMMARY", "TEXT"],
	// Date/time (DATE_TIME by default; VALUE=DATE overrides to DATE)
	["COMPLETED", "DATE_TIME"],
	["DTEND", "DATE_TIME"],
	["DUE", "DATE_TIME"],
	["DTSTART", "DATE_TIME"],
	["RECURRENCE-ID", "DATE_TIME"],
	["DURATION", "DURATION"],
	["FREEBUSY", "PERIOD_LIST"],
	["TRANSP", "TEXT"],
	// Timezone
	["TZID", "TEXT"],
	["TZNAME", "TEXT"],
	["TZOFFSETFROM", "UTC_OFFSET"],
	["TZOFFSETTO", "UTC_OFFSET"],
	["TZURL", "URI"],
	// Relationship
	["ATTENDEE", "CAL_ADDRESS"],
	["CONTACT", "TEXT"],
	["ORGANIZER", "CAL_ADDRESS"],
	["RELATED-TO", "TEXT"],
	["URL", "URI"],
	["UID", "TEXT"],
	// Recurrence
	["EXDATE", "DATE_TIME_LIST"],
	["EXRULE", "RECUR"],
	["RDATE", "DATE_TIME_LIST"],
	["RRULE", "RECUR"],
	// Alarm
	["ACTION", "TEXT"],
	["REPEAT", "INTEGER"],
	["TRIGGER", "DURATION"],
	// Change management
	["CREATED", "DATE_TIME"],
	["DTSTAMP", "DATE_TIME"],
	["LAST-MODIFIED", "DATE_TIME"],
	["SEQUENCE", "INTEGER"],
	["REQUEST-STATUS", "TEXT"],
]);

/**
 * Returns true if the property name is a known iCalendar property (RFC 5545 §3.8).
 * Returns false for X- prefixed and unrecognized IANA properties.
 * Derived at runtime so that newly added entries automatically become "known".
 */
export const isKnownIcalProperty = (name: string): boolean =>
	ICAL_DEFAULT_TYPES.has(name);
