import { Effect } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId } from "#src/domain/ids.ts";
import { HTTP_OK } from "#src/http/status.ts";
import {
	applyVisibilityToEventView,
	collectCalendarEvents,
	toFullCalendarEvent,
} from "#src/http/ui/api/calendar/collect-events.ts";
import { parseInstantParam } from "#src/http/ui/api/calendar/events.ts";
import type { CalIndexRepository } from "#src/services/cal-index/index.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { InstanceRepository } from "#src/services/instance/repository.ts";
import type { ShareLinkCalendarRow } from "#src/services/share-link/repository.ts";

// ---------------------------------------------------------------------------
// GET /embed/<token>/events?start=…&end=… — JSON event data for the public
// calendar widget. Token-scoped (not ACL-scoped, unlike
// ui/api/calendar/events.ts): the caller already resolved and filtered
// `calendars` down to this share-link's `embedEnabled` rows before calling in
// (see http/embed/handler.ts). Reuses the same collectCalendarEvents /
// toFullCalendarEvent data path as every other calendar view, then applies
// each calendar's visibility rule (same policy as the .ics feed).
// ---------------------------------------------------------------------------

export const embedCalendarEventsHandler = (
	url: URL,
	calendars: ReadonlyArray<ShareLinkCalendarRow>,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	CalIndexRepository | ComponentRepository | InstanceRepository
> =>
	Effect.gen(function* () {
		const rangeStart = parseInstantParam(url.searchParams.get("start"));
		const rangeEnd = parseInstantParam(url.searchParams.get("end"));

		const perCalendar = yield* Effect.forEach(calendars, (cal) =>
			collectCalendarEvents(
				CollectionId(cal.calendarId),
				rangeStart,
				rangeEnd,
			).pipe(
				Effect.map((views) =>
					views.map((v) => applyVisibilityToEventView(v, cal.visibility)),
				),
			),
		);
		const events = perCalendar.flat().map(toFullCalendarEvent);

		return new Response(JSON.stringify(events), {
			status: HTTP_OK,
			headers: { "Content-Type": "application/json; charset=utf-8" },
		});
	});
