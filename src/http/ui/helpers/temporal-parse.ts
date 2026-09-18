import { Option } from "effect";
import { Temporal } from "temporal-polyfill";

// ---------------------------------------------------------------------------
// Lenient Temporal parsing for UI input
//
// Temporal's `from` constructors throw on malformed input. UI pages and JSON
// feeds render whatever the store holds, so a value that cannot be parsed has
// to degrade (an open-ended range bound, a raw string label) rather than fail
// the request. These lift the throw into an Option so callers decide.
// ---------------------------------------------------------------------------

/** A `YYYY-MM-DD` date, or none when the value is not one */
export const parsePlainDate = Option.liftThrowable((value: string) =>
	Temporal.PlainDate.from(value),
);

/** A `YYYY-MM-DDTHH:mm[:ss]` local date-time, or none when the value is not one */
export const parsePlainDateTime = Option.liftThrowable((value: string) =>
	Temporal.PlainDateTime.from(value),
);

/** A `YYYY-MM` month, or none when the value is not one */
export const parsePlainYearMonth = Option.liftThrowable((value: string) =>
	Temporal.PlainYearMonth.from(value),
);

/** An ISO instant, or none when the value is not one */
export const parseInstant = Option.liftThrowable((value: string) =>
	Temporal.Instant.from(value),
);

/**
 * A stored floating date (all-day) or local date-time, resolved to an instant.
 *
 * The resolution zone is the caller's decision and always explicit; see the
 * "Dates and Times" notes in CLAUDE.md.
 */
export const parseFloatingInstant = (
	value: string,
	allDay: boolean,
	zone: string,
): Option.Option<Temporal.Instant> =>
	allDay
		? Option.map(parsePlainDate(value), (date) =>
				date.toZonedDateTime(zone).toInstant(),
			)
		: Option.map(parsePlainDateTime(value), (dateTime) =>
				dateTime.toZonedDateTime(zone).toInstant(),
			);
