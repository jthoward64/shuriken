import { Effect, Option } from "effect";
import {
	tzlib_get_ical_block,
	tzlib_get_timezones,
} from "timezones-ical-library";

// ---------------------------------------------------------------------------
// IanaTimezoneService — wraps timezones-ical-library to provide VTIMEZONE
// component data for all IANA timezones.
//
// Used by:
//   - RFC 7808 timezone distribution service (/timezones endpoint)
//   - RFC 7809 VTIMEZONE stripping (CalDAV-Timezones: F header)
//   - CALDAV:calendar-timezone-id PROPPATCH validation
//   - CALDAV:timezone-id in calendar-query REPORT
// ---------------------------------------------------------------------------

export interface IanaTimezoneServiceShape {
	/**
	 * Returns the VTIMEZONE iCalendar component text for a known IANA timezone.
	 * Returns None for unknown or non-IANA timezone identifiers.
	 */
	readonly getVtimezone: (tzid: string) => Option.Option<string>;

	/**
	 * Returns the list of all supported IANA timezone identifiers.
	 */
	readonly listTzids: () => ReadonlyArray<string>;

	/**
	 * Returns true if the given TZID corresponds to a known IANA timezone.
	 */
	readonly isKnownTzid: (tzid: string) => boolean;
}

export class IanaTimezoneService extends Effect.Service<IanaTimezoneService>()(
	"IanaTimezoneService",
	{
		sync: () => {
			// Pre-build a Set for O(1) lookups — tzlib_get_timezones() is stable data.
			const rawList = tzlib_get_timezones();
			const tzids: ReadonlyArray<string> = Array.isArray(rawList)
				? (rawList as Array<string>)
				: [];
			const knownSet = new Set<string>(tzids);

			const getVtimezone = (tzid: string): Option.Option<string> => {
				if (!knownSet.has(tzid)) {
					return Option.none();
				}
				const result = tzlib_get_ical_block(tzid);
				// tzlib_get_ical_block returns "" for unknown TZIDs (won't happen here
				// since we guard with knownSet) or [vtimezoneBlock, tzidLine] for known.
				if (typeof result === "string" || result.length === 0) {
					return Option.none();
				}
				const [vtimezoneBlock] = result as [string, string];
				return vtimezoneBlock ? Option.some(vtimezoneBlock) : Option.none();
			};

			const listTzids = (): ReadonlyArray<string> => tzids;

			const isKnownTzid = (tzid: string): boolean => knownSet.has(tzid);

			return { getVtimezone, listTzids, isKnownTzid };
		},
	},
) {}
