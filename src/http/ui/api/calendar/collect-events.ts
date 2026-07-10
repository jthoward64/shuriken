import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import type { ShareLinkVisibility } from "#src/db/drizzle/schema/index.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import {
	type CollectionId,
	EntityId,
	InstanceId,
	type UuidString,
} from "#src/domain/ids.ts";
import { parseVeventToForm } from "#src/services/cal-edit/parse-vevent.ts";
import { CalIndexRepository } from "#src/services/cal-index/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import {
	InstanceRepository,
	type InstanceRow,
} from "#src/services/instance/repository.ts";
import {
	BUSY_SUMMARY,
	stripsPrivateFields,
	stripsTitle,
} from "#src/services/share-link/visibility-policy.ts";

// ---------------------------------------------------------------------------
// Shared calendar-event collection — the single data path behind both the
// FullCalendar JSON feed (api/calendar/events.ts) and the no-JS server-rendered
// event list (handlers/calendar/view.ts). Narrows candidate events in SQL via
// findOverlappingRange (a correct superset that keeps recurring masters whose
// series precede the window) and projects each VEVENT's owned fields.
//
// Recurrence expansion stays client-side (FullCalendar's rrule plugin); the
// no-JS list shows each series once with a "repeats …" label rather than
// expanding occurrences server-side.
// ---------------------------------------------------------------------------

/** Projected view of a VEVENT, engine-agnostic. `rruleRaw` is the verbatim
 * RRULE RECUR value (e.g. `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE`) — no parts
 * dropped — or null for a non-recurring event. */
export interface CalendarEventView {
	readonly id: string;
	readonly title: string;
	readonly allDay: boolean;
	/** Master DTSTART, ISO local (`YYYY-MM-DD` all-day / `YYYY-MM-DDTHH:mm`). */
	readonly start: string;
	/** DTEND in the same ISO form, or null when the event has no DTEND. */
	readonly end: string | null;
	readonly rruleRaw: string | null;
	readonly description: string;
	readonly location: string;
	readonly categoriesCsv: string;
}

/** Apply a share-link's visibility rule to a projected event view — used by
 * the public embed widget's JSON event feed (see http/embed/events.ts). Same
 * policy as the ICS feed (feed/render.ts), applied to this narrower
 * projection: `limited` strips description/location, `free_busy` additionally
 * replaces the title with {@link BUSY_SUMMARY}. */
export const applyVisibilityToEventView = (
	ev: CalendarEventView,
	visibility: ShareLinkVisibility,
): CalendarEventView => {
	if (!stripsPrivateFields(visibility)) {
		return ev;
	}
	return {
		...ev,
		description: "",
		location: "",
		title: stripsTitle(visibility) ? BUSY_SUMMARY : ev.title,
	};
};

/** Load component trees for the given instance rows and project each VEVENT
 * into a {@link CalendarEventView}. The shared tail of both `collectCalendarEvents`
 * (per-collection) and the individually-shared-instance path (no owning
 * collection to scope a `findOverlappingRange` query by). */
export const collectCalendarEventsForInstances = (
	instances: ReadonlyArray<InstanceRow>,
): Effect.Effect<
	ReadonlyArray<CalendarEventView>,
	DavError | DatabaseError | InternalError,
	ComponentRepository
> =>
	Effect.gen(function* () {
		const componentRepo = yield* ComponentRepository;

		// Batch-load every instance's component tree in 3 queries total instead
		// of 3 per instance.
		const trees = yield* componentRepo.loadTreesByIds(
			instances.map((inst) => EntityId(inst.entityId)),
			"icalendar",
		);

		const events: Array<CalendarEventView> = [];
		for (const inst of instances) {
			const tree = trees.get(EntityId(inst.entityId));
			if (tree === undefined) {
				continue;
			}
			const vevent = tree.components.find((c) => c.name === "VEVENT");
			if (!vevent) {
				continue;
			}
			const form = parseVeventToForm(vevent);
			if (form.start === "") {
				continue;
			}
			// Read the RRULE straight from the IR so INTERVAL/BYDAY/BYMONTHDAY etc.
			// survive verbatim — the form parser only keeps FREQ/COUNT/UNTIL.
			const rruleProp = vevent.properties.find((p) => p.name === "RRULE");
			const rruleRaw =
				rruleProp && rruleProp.value.type === "RECUR"
					? rruleProp.value.value
					: null;

			events.push({
				id: inst.id,
				title: form.summary || "(no title)",
				allDay: form.allDay,
				start: form.start,
				end: form.end !== "" ? form.end : null,
				rruleRaw,
				description: form.description,
				location: form.location,
				categoriesCsv: form.categoriesCsv,
			});
		}
		return events;
	});

export const collectCalendarEvents = (
	collectionId: CollectionId,
	rangeStart: Temporal.Instant | null,
	rangeEnd: Temporal.Instant | null,
): Effect.Effect<
	ReadonlyArray<CalendarEventView>,
	DavError | DatabaseError | InternalError,
	CalIndexRepository | ComponentRepository | InstanceRepository
> =>
	Effect.gen(function* () {
		const instRepo = yield* InstanceRepository;
		const calIdx = yield* CalIndexRepository;

		const candidateIds = yield* calIdx.findOverlappingRange(
			collectionId,
			"VEVENT",
			rangeStart,
			rangeEnd,
		);
		const instances = yield* instRepo.findByIds(
			candidateIds.map((id) => InstanceId(id as UuidString)),
		);
		return yield* collectCalendarEventsForInstances(instances);
	});

// ---------------------------------------------------------------------------
// FullCalendar mapping
// ---------------------------------------------------------------------------

/** FullCalendar event JSON. For recurring events we emit `rrule` (with the real
 * DTSTART embedded so rrule.js doesn't default it to "now") plus `duration`
 * (the rrule plugin ignores `end` for recurring events); non-recurring events
 * keep plain `start`/`end`. */
export interface FullCalendarEvent {
	readonly id: string;
	readonly title: string;
	readonly allDay: boolean;
	readonly start?: string;
	readonly end?: string | null;
	readonly rrule?: string;
	readonly duration?: string;
	readonly extendedProps: {
		readonly description: string;
		readonly location: string;
		readonly categoriesCsv: string;
		/** False for a free-busy-only (or otherwise non-full-read) event — the
		 * client must not open the edit dialog for it (that route requires
		 * DAV:read and would 403); it falls back to the read-only preview
		 * card instead. See calendar.client.ts's eventClick. */
		readonly readable: boolean;
	};
}

/** ISO local (`YYYY-MM-DD` / `YYYY-MM-DDTHH:mm`) → iCalendar basic form
 * (`YYYYMMDD` / `YYYYMMDDTHHMMSS`). */
const toICalBasic = (iso: string, allDay: boolean): string => {
	const compact = iso.replace(/[-:]/g, "");
	return allDay ? compact : `${compact}00`;
};

/** ISO 8601 duration between DTSTART and DTEND, or undefined when there's no
 * DTEND (FullCalendar then falls back to its default event length). */
const durationBetween = (
	start: string,
	end: string | null,
	allDay: boolean,
): string | undefined => {
	if (end === null) {
		return undefined;
	}
	try {
		if (allDay) {
			const d = Temporal.PlainDate.from(end).since(
				Temporal.PlainDate.from(start),
				{ largestUnit: "day" },
			);
			return d.sign > 0 ? d.toString() : undefined;
		}
		const d = Temporal.PlainDateTime.from(end).since(
			Temporal.PlainDateTime.from(start),
			{ largestUnit: "hour" },
		);
		return d.sign > 0 ? d.toString() : undefined;
	} catch {
		return undefined;
	}
};

export const toFullCalendarEvent = (
	ev: CalendarEventView,
	readable = true,
): FullCalendarEvent => {
	const extendedProps = {
		description: ev.description,
		location: ev.location,
		categoriesCsv: ev.categoriesCsv,
		readable,
	};
	if (ev.rruleRaw !== null) {
		const dtstart = ev.allDay
			? `DTSTART;VALUE=DATE:${toICalBasic(ev.start, true)}`
			: `DTSTART:${toICalBasic(ev.start, false)}`;
		return {
			id: ev.id,
			title: ev.title,
			allDay: ev.allDay,
			rrule: `${dtstart}\nRRULE:${ev.rruleRaw}`,
			duration: durationBetween(ev.start, ev.end, ev.allDay),
			extendedProps,
		};
	}
	return {
		id: ev.id,
		title: ev.title,
		allDay: ev.allDay,
		start: ev.start,
		end: ev.end,
		extendedProps,
	};
};
