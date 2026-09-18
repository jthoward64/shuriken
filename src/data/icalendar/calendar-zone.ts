// ---------------------------------------------------------------------------
// Resolving the zone a CalDAV request reads floating values in.
//
// RFC 4791 section 7.3 fixes the precedence for calendar-query, and section
// 5.2.2 applies the same calendar-timezone to free-busy: the CALDAV:timezone
// sent with the request wins, failing that the collection's
// CALDAV:calendar-timezone, and only if neither is usable may the server pick
// its own. That last step is UTC here.
// ---------------------------------------------------------------------------

import { Option } from "effect";
import { parseZone, type ResolutionZone, UTC } from "./resolve-floating.ts";

/**
 * Extract the TZID from a raw VTIMEZONE/VCALENDAR iCalendar text string.
 * Returns null if no TZID line is found.
 */
export const extractTzidFromVtimezone = (raw: string): string | null => {
	const match = /^TZID[;:]([^\r\n]+)/mu.exec(raw);
	return match?.[1]?.trim() ?? null;
};

export interface CalendarZoneSources {
	/** Raw CALDAV:timezone body (a VTIMEZONE) sent with the report, if any. */
	readonly requestTimezone?: string | null;
	/** CALDAV:timezone-id sent with the report (RFC 7809 section 6.2), if any. */
	readonly requestTzid?: string | null;
	/** The collection's stored CALDAV:calendar-timezone. */
	readonly collectionTzid?: string | null;
}

/**
 * Applies RFC 4791 section 7.3's precedence to pick a resolution zone.
 *
 * A source that names a zone this runtime does not know is skipped rather than
 * collapsing straight to UTC, so a client sending an unrecognised VTIMEZONE
 * still gets the calendar's own zone instead of the server's last resort.
 */
export const resolveCalendarZone = (
	sources: CalendarZoneSources,
): ResolutionZone => {
	const fromVtimezone = parseZone(
		sources.requestTimezone
			? extractTzidFromVtimezone(sources.requestTimezone)
			: null,
	);
	const fromRequest = Option.orElse(fromVtimezone, () =>
		parseZone(sources.requestTzid),
	);
	return Option.getOrElse(
		Option.orElse(fromRequest, () => parseZone(sources.collectionTzid)),
		() => UTC,
	);
};
