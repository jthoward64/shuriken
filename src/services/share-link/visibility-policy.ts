import type { ShareLinkVisibility } from "#src/db/drizzle/schema/index.ts";

// ---------------------------------------------------------------------------
// Shared share-link visibility policy — which fields a `limited`/`free_busy`
// share hides, applied identically by the ICS feed (feed/render.ts, on
// IrComponent properties) and the public embed widget's JSON event feed
// (ui/api/calendar/collect-events.ts, on CalendarEventView). The two operate
// on different data shapes, so each does its own field stripping, but both
// key off this one constant so "what does `free_busy` replace the title
// with" never drifts between the two surfaces.
// ---------------------------------------------------------------------------

export const BUSY_SUMMARY = "Busy";

/** True when `visibility` requires stripping description/location/attendee/
 * organizer-equivalent fields (both `limited` and `free_busy`). */
export const stripsPrivateFields = (visibility: ShareLinkVisibility): boolean =>
	visibility !== "all";

/** True when `visibility` additionally replaces the title with {@link BUSY_SUMMARY}. */
export const stripsTitle = (visibility: ShareLinkVisibility): boolean =>
	visibility === "free_busy";
