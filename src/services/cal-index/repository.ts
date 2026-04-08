import type { Effect } from "effect";
import { Context } from "effect";
import type { Temporal } from "temporal-polyfill";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { CollectionId, EntityId } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// CalIndexRepository — data access for cal_index rows
//
// The cal_index table is populated and maintained automatically by the
// maintain_cal_index_on_instance_change() SQL trigger fired AFTER INSERT OR
// UPDATE on dav_instance.
//
// Queries here are used by the calendar-query REPORT handler to pre-filter
// candidate entities before in-memory filter evaluation.
// ---------------------------------------------------------------------------

/** Component types tracked in cal_index. */
export type CalComponentType = "VEVENT" | "VTODO" | "VJOURNAL" | "VFREEBUSY";

export interface CalIndexRepositoryShape {
	/**
	 * Return entity UUIDs (as strings) whose cal_index entries overlap the
	 * given time range [start, end) for the specified component type.
	 *
	 * Overlap condition: dtstart_utc < end AND (dtend_utc > start OR dtend_utc IS NULL)
	 *
	 * RRULE rows are filtered with a week-bucket heuristic keyed on
	 * `weekStart`/`weekEnd` (the calendar week containing `start`). The
	 * in-memory filter (hasOccurrenceInRange) performs the exact check
	 * afterwards.
	 *
	 * Pass null for start or end to leave that side open-ended.
	 */
	readonly findByTimeRange: (
		collectionId: CollectionId,
		componentType: CalComponentType,
		start: Temporal.Instant | null,
		end: Temporal.Instant | null,
		weekStart: Temporal.Instant | null,
		weekEnd: Temporal.Instant | null,
	) => Effect.Effect<ReadonlyArray<string>, DatabaseError>;

	/**
	 * Return entity UUIDs that have at least one component of the given type
	 * in the collection (no time-range filter).
	 */
	readonly findByComponentType: (
		collectionId: CollectionId,
		componentType: CalComponentType,
	) => Effect.Effect<ReadonlyArray<string>, DatabaseError>;

	/**
	 * After a PUT saves a recurring instance, populate the precomputed RRULE
	 * shape columns (`rrule_occurrence_months`, `rrule_occurrence_day_min`,
	 * `rrule_occurrence_day_max`) in cal_index.
	 *
	 * These are used by the week-bucket SQL pre-filter in `findByTimeRange` to
	 * accurately exclude YEARLY/MONTHLY rules whose occurrences fall outside
	 * the queried week. They cannot be computed inside the PG trigger because
	 * `rrule-temporal` is required for correct BY-rule expansion.
	 */
	readonly indexRruleOccurrences: (
		entityId: EntityId,
	) => Effect.Effect<void, DatabaseError>;
}

export class CalIndexRepository extends Context.Tag("CalIndexRepository")<
	CalIndexRepository,
	CalIndexRepositoryShape
>() {}
