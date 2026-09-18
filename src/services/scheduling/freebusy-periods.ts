// ---------------------------------------------------------------------------
// Pure free-busy period extraction from a stored iCalendar component tree
// ---------------------------------------------------------------------------

import { Temporal } from "temporal-polyfill";
import {
	deriveFbType,
	type FbType,
	type Period,
} from "#src/data/icalendar/freebusy.ts";
import {
	effectiveDtend,
	getDtstartInstant,
} from "#src/data/icalendar/ir-helpers.ts";
import { getOccurrenceInstantsInRange } from "#src/data/icalendar/recurrence/recurrence-check.ts";
import type { ResolutionZone } from "#src/data/icalendar/resolve-floating.ts";
import type { IrComponent } from "#src/data/ir.ts";

/** The window a free-busy request asks about, plus the zone floating values resolve in */
export interface FreeBusyWindow {
	readonly queryStart: Temporal.Instant;
	readonly queryEnd: Temporal.Instant;
	readonly zone: ResolutionZone;
}

/** Clip an interval to the query window */
const clampPeriod = (
	start: Temporal.Instant,
	end: Temporal.Instant,
	fbType: FbType,
	window: FreeBusyWindow,
): Period => ({
	start:
		start.epochMilliseconds < window.queryStart.epochMilliseconds
			? window.queryStart
			: start,
	end:
		end.epochMilliseconds > window.queryEnd.epochMilliseconds
			? window.queryEnd
			: end,
	fbType,
});

/** True when an interval lies entirely outside the query window */
const outsideWindow = (
	start: Temporal.Instant,
	end: Temporal.Instant,
	window: FreeBusyWindow,
): boolean =>
	start.epochMilliseconds >= window.queryEnd.epochMilliseconds ||
	end.epochMilliseconds <= window.queryStart.epochMilliseconds;

/** The master occurrence a recurring component expands from */
interface SeriesAnchor {
	readonly masterStart: Temporal.Instant;
	readonly fbType: FbType;
}

/** One period per expanded occurrence of a recurring component */
const recurringPeriods = (
	root: IrComponent,
	comp: IrComponent,
	anchor: SeriesAnchor,
	window: FreeBusyWindow,
): ReadonlyArray<Period> => {
	const duration =
		effectiveDtend(comp, anchor.masterStart, window.zone).epochMilliseconds -
		anchor.masterStart.epochMilliseconds;
	return getOccurrenceInstantsInRange(root, comp, window).map((start) =>
		clampPeriod(
			start,
			Temporal.Instant.fromEpochMilliseconds(
				start.epochMilliseconds + duration,
			),
			anchor.fbType,
			window,
		),
	);
};

/**
 * The busy periods a single VEVENT contributes to a free-busy aggregate.
 *
 * Overrides (RFC 5545 §3.8.4.4) carry their own DTSTART/DTEND and replace the
 * master's occurrence at their RECURRENCE-ID; the recurrence expansion excludes
 * that slot from the master, so an override is emitted as a one-shot period.
 */
export const componentPeriods = (
	root: IrComponent,
	comp: IrComponent,
	window: FreeBusyWindow,
): ReadonlyArray<Period> => {
	const fbType = deriveFbType(comp);
	if (fbType === null) {
		return [];
	}
	const dtstart = getDtstartInstant(comp, window.zone);
	if (!dtstart) {
		return [];
	}
	if (comp.properties.some((p) => p.name === "RRULE")) {
		return recurringPeriods(
			root,
			comp,
			{ masterStart: dtstart, fbType },
			window,
		);
	}
	const dtend = effectiveDtend(comp, dtstart, window.zone);
	return outsideWindow(dtstart, dtend, window)
		? []
		: [clampPeriod(dtstart, dtend, fbType, window)];
};

/** Every VEVENT period in a stored resource's component tree */
export const treePeriods = (
	root: IrComponent,
	window: FreeBusyWindow,
): ReadonlyArray<Period> =>
	root.components
		.filter((comp) => comp.name === "VEVENT")
		.flatMap((comp) => componentPeriods(root, comp, window));
