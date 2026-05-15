import { Effect, Option } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { type CollectionId, EntityId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { AclService } from "#src/services/acl/service.ts";
import { parseVeventToForm } from "#src/services/cal-edit/parse-vevent.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";

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
	AclService | ComponentRepository | InstanceRepository
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const componentRepo = yield* ComponentRepository;
		const instRepo = yield* InstanceRepository;

		yield* acl.check(
			principal.principalId,
			collectionId,
			"collection",
			"DAV:read",
		);

		const instances = yield* instRepo.listByCollection(collectionId);
		const events: Array<FullCalendarEvent> = [];

		for (const inst of instances) {
			const tree = yield* componentRepo.loadTree(
				EntityId(inst.entityId),
				"icalendar",
			);
			if (Option.isNone(tree)) {
				continue;
			}
			const vevent = tree.value.components.find((c) => c.name === "VEVENT");
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
