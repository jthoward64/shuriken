import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
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
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { AclService } from "#src/services/acl/service.ts";
import { parseVeventToForm } from "#src/services/cal-edit/parse-vevent.ts";
import { CalIndexRepository } from "#src/services/cal-index/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";

/** Parse a FullCalendar `start`/`end` query param to an Instant, or null. */
const parseInstantParam = (raw: string | null): Temporal.Instant | null => {
	if (raw === null || raw === "") {
		return null;
	}
	try {
		return Temporal.Instant.from(raw);
	} catch {
		// Lenient: an unparseable bound leaves that side open-ended rather than
		// erroring the feed.
		return null;
	}
};

// ---------------------------------------------------------------------------
// GET /ui/api/calendar/:collectionId/events?start=…&end=…
//
// Returns FullCalendar-compatible JSON for events in the given calendar.
// Filtering by start/end is approximate: we project the IR DTSTART/DTEND
// without expanding recurrences, then let FullCalendar handle RRULE-aware
// rendering on the client via its own (optional) rrule plugin. For v1 we
// expose `rrule` as a plain string field; expansion stays client-side.
// ---------------------------------------------------------------------------

interface FullCalendarEvent {
	readonly id: string;
	readonly title: string;
	readonly start: string;
	readonly end: string | null;
	readonly allDay: boolean;
	readonly rrule: string | null;
	readonly extendedProps: {
		readonly description: string;
		readonly location: string;
		readonly categoriesCsv: string;
	};
}

export const calendarEventsHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	collectionId: CollectionId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | CalIndexRepository | ComponentRepository | InstanceRepository
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const componentRepo = yield* ComponentRepository;
		const instRepo = yield* InstanceRepository;
		const calIdx = yield* CalIndexRepository;

		yield* acl.check(
			principal.principalId,
			collectionId,
			"collection",
			"DAV:read",
		);

		// Narrow to events that could fall in the requested FullCalendar window in
		// SQL (a correct superset — recurring series whose master precedes the
		// window are kept so the client can expand them). With no range params
		// this returns every VEVENT, preserving prior behaviour.
		const rangeStart = parseInstantParam(ctx.url.searchParams.get("start"));
		const rangeEnd = parseInstantParam(ctx.url.searchParams.get("end"));
		const candidateIds = yield* calIdx.findOverlappingRange(
			collectionId,
			"VEVENT",
			rangeStart,
			rangeEnd,
		);
		const instances = yield* instRepo.findByIds(
			candidateIds.map((id) => InstanceId(id as UuidString)),
		);

		// Batch-load every instance's component tree in 3 queries total instead
		// of 3 per instance.
		const trees = yield* componentRepo.loadTreesByIds(
			instances.map((inst) => EntityId(inst.entityId)),
			"icalendar",
		);

		const events: Array<FullCalendarEvent> = [];
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
			const rrule =
				form.recurrenceFreq === ""
					? null
					: form.recurrenceCount !== ""
						? `FREQ=${form.recurrenceFreq};COUNT=${form.recurrenceCount}`
						: form.recurrenceUntil !== ""
							? `FREQ=${form.recurrenceFreq};UNTIL=${form.recurrenceUntil.replace(/-/g, "")}`
							: `FREQ=${form.recurrenceFreq}`;
			events.push({
				id: inst.id,
				title: form.summary || "(no title)",
				start: form.start,
				end: form.end !== "" ? form.end : null,
				allDay: form.allDay,
				rrule,
				extendedProps: {
					description: form.description,
					location: form.location,
					categoriesCsv: form.categoriesCsv,
				},
			});
		}

		return new Response(JSON.stringify(events), {
			status: 200,
			headers: { "Content-Type": "application/json; charset=utf-8" },
		});
	});
