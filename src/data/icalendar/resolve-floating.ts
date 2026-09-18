// ---------------------------------------------------------------------------
// Floating-time resolution — RFC 4791 section 7.3
//
// RFC 5545 Form 1 values (DTSTART with no TZID and no `Z`) name a wall-clock
// time with no instant attached, and DATE values name a day whose boundaries
// are equally local. Comparing either against a time-range filter requires
// choosing a zone, and RFC 4791 section 7.3 says which: the CALDAV:timezone
// sent with the request, failing that the collection's CALDAV:calendar-timezone,
// and only failing both may the server pick. That choice changes which events
// match, so it is passed explicitly rather than read from ambient state.
// ---------------------------------------------------------------------------

import { Brand, Option } from "effect";
import { Temporal } from "temporal-polyfill";

/**
 * A timezone identifier already checked against the runtime's tz database.
 *
 * Branded so a raw client-supplied TZID cannot reach a resolver unchecked:
 * `Temporal` throws on an unknown zone, and an exception raised while
 * evaluating one event would fail the whole REPORT.
 */
export type ResolutionZone = string & Brand.Brand<"ResolutionZone">;

const brand = Brand.nominal<ResolutionZone>();

/** The fallback whenever no usable zone is supplied. */
export const UTC: ResolutionZone = brand("UTC");

// Only successful lookups are cached, so a client sending endless junk TZIDs
// cannot grow this past the size of the tz database
const validated = new Map<string, ResolutionZone>([["UTC", UTC]]);

// Clients from the Mozilla/Oracle lineage prefix a real IANA name with a
// versioned path, e.g. `/mozilla.org/20050126_1/Europe/Berlin`. The trailing
// `Area/Location` is the zone they mean.
const PREFIXED_TZID = /^\/[^/]*\/[^/]*\/(?<iana>[^/]+\/[^/]+)$/u;

// temporal-polyfill exposes no standalone validator, so project a fixed instant
// into the zone: cheap, and throws on an unknown id
const projectIntoZone = Option.liftThrowable((tzid: string) =>
	Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(tzid),
);

const isKnownZone = (tzid: string): boolean =>
	Option.isSome(projectIntoZone(tzid));

/**
 * Validates a TZID for use as a resolution zone.
 *
 * Returns `None` for an absent, unparseable or unknown zone so a caller
 * working down RFC 4791 section 7.3's precedence chain can try the next
 * source rather than settling for UTC too early. Never throws.
 */
export const parseZone = (
	tzid: string | null | undefined,
): Option.Option<ResolutionZone> => {
	if (tzid === null || tzid === undefined || tzid === "") {
		return Option.none();
	}
	const cached = validated.get(tzid);
	if (cached !== undefined) {
		return Option.some(cached);
	}
	const iana = PREFIXED_TZID.exec(tzid)?.groups?.iana ?? tzid;
	if (!isKnownZone(iana)) {
		return Option.none();
	}
	const zone = brand(iana);
	validated.set(tzid, zone);
	return Option.some(zone);
};

/**
 * Validates a TZID, falling back to UTC.
 *
 * UTC is the RFC's last resort, chosen only once every named source has been
 * exhausted, so this is for callers that have no further fallback to try.
 */
export const resolutionZone = (
	tzid: string | null | undefined,
): ResolutionZone => Option.getOrElse(parseZone(tzid), () => UTC);

/**
 * Resolves a floating date-time to the instant it names in `zone`.
 *
 * A wall time lost to a DST gap (02:30 on a spring-forward day) does not exist
 * in the zone; Temporal's default `compatible` disambiguation pushes it forward
 * by the size of the gap, which is what RFC 5545 section 3.2.19 prescribes for
 * the equivalent VTIMEZONE case. An ambiguous autumn time takes the earlier of
 * the two offsets.
 */
export const resolveFloatingDateTime = (
	wall: Temporal.PlainDateTime,
	zone: ResolutionZone,
): Temporal.Instant => wall.toZonedDateTime(zone).toInstant();

/** Resolves a DATE to the start of that day in `zone`. */
export const resolveFloatingDate = (
	day: Temporal.PlainDate,
	zone: ResolutionZone,
): Temporal.Instant => day.toZonedDateTime(zone).toInstant();

/** Resolves a DATE to the start of the following day in `zone`. */
export const resolveFloatingDateEnd = (
	day: Temporal.PlainDate,
	zone: ResolutionZone,
): Temporal.Instant => resolveFloatingDate(day.add({ days: 1 }), zone);
