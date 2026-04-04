import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { calTimezone } from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#src/domain/errors.ts";

// ---------------------------------------------------------------------------
// CalTimezoneRepository — data access for cal_timezone rows
//
// Stores VTIMEZONE component data from iCalendar objects so that floating
// datetimes can be resolved against client-provided timezone definitions.
// ---------------------------------------------------------------------------

export type CalTimezoneRow = InferSelectModel<typeof calTimezone>;

export interface CalTimezoneRepositoryShape {
	/**
	 * Look up a timezone by its TZID string (as it appears in iCalendar).
	 * Returns None if not found.
	 */
	readonly findByTzid: (
		tzid: string,
	) => Effect.Effect<Option.Option<CalTimezoneRow>, DatabaseError>;

	/**
	 * Insert or update a timezone record.
	 * If a row with the same tzid already exists, updates vtimezone_data and
	 * iana_name (if provided) in place.
	 */
	readonly upsert: (
		tzid: string,
		vtimezoneData: string,
		ianaName: Option.Option<string>,
	) => Effect.Effect<CalTimezoneRow, DatabaseError>;
}

export class CalTimezoneRepository extends Context.Tag("CalTimezoneRepository")<
	CalTimezoneRepository,
	CalTimezoneRepositoryShape
>() {}
