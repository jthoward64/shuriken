import type { FieldVisibility } from "#src/data/icalendar/visibility.ts";
import type { ShareLinkVisibility } from "#src/db/drizzle/schema/index.ts";

// ---------------------------------------------------------------------------
// Shared share-link visibility policy — which fields a `limited`/`free_busy`
// share hides, applied identically by the ICS feed (feed/render.ts, on
// IrComponent properties, via src/data/icalendar/visibility.ts) and the
// public embed widget's JSON event feed (ui/api/calendar/collect-events.ts,
// on CalendarEventView). The two operate on different data shapes, so each
// does its own field stripping, but both key off the same BUSY_SUMMARY
// constant so "what does `free_busy` replace the title with" never drifts
// between the two surfaces.
// ---------------------------------------------------------------------------

export { BUSY_SUMMARY } from "#src/data/icalendar/visibility.ts";

/** Maps a share-link visibility level onto the generic redaction levels in
 * src/data/icalendar/visibility.ts. */
export const toFieldVisibility = (
	visibility: ShareLinkVisibility,
): FieldVisibility => {
	switch (visibility) {
		case "all":
			return "full";
		case "limited":
			return "titled";
		case "free_busy":
			return "busy_only";
	}
};

/** True when `visibility` requires stripping description/location/attendee/
 * organizer-equivalent fields (both `limited` and `free_busy`). */
export const stripsPrivateFields = (visibility: ShareLinkVisibility): boolean =>
	visibility !== "all";

/** True when `visibility` additionally replaces the title with {@link BUSY_SUMMARY}. */
export const stripsTitle = (visibility: ShareLinkVisibility): boolean =>
	visibility === "free_busy";
