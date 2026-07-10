import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { CollectionId } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	notModifiedPageResponse,
	PageCacheService,
	pageEtag,
	withPageCacheHeaders,
} from "#src/http/ui/page-cache/index.ts";
import { AclService } from "#src/services/acl/service.ts";
import type { CalIndexRepository } from "#src/services/cal-index/index.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { InstanceRepository } from "#src/services/instance/repository.ts";
import {
	applyVisibilityToEventView,
	collectCalendarEvents,
	toFullCalendarEvent,
} from "./collect-events.ts";

/** Parse a FullCalendar `start`/`end` query param to an Instant, or null. */
export const parseInstantParam = (
	raw: string | null,
): Temporal.Instant | null => {
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
// Filtering by start/end is approximate: findOverlappingRange returns a correct
// superset (including recurring masters that precede the window); the rrule
// plugin expands occurrences on the client. See collect-events.ts for the
// shared data path and FullCalendar mapping.
// ---------------------------------------------------------------------------

export const calendarEventsHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	collectionId: CollectionId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclService
	| CalIndexRepository
	| CollectionRepository
	| ComponentRepository
	| InstanceRepository
	| PageCacheService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const collections = yield* CollectionRepository;

		// At least free-busy-only read is required; DAV:read/DAV:all also
		// satisfy this via the privilege hierarchy.
		yield* acl.check(
			principal.principalId,
			collectionId,
			"collection",
			"CALDAV:read-free-busy",
		);
		const collectionPrivileges = yield* acl.currentUserPrivileges(
			principal.principalId,
			collectionId,
			"collection",
		);
		const hasFullRead = collectionPrivileges.includes("DAV:read");

		const rangeStart = parseInstantParam(ctx.url.searchParams.get("start"));
		const rangeEnd = parseInstantParam(ctx.url.searchParams.get("end"));

		// Conditional GET — this feed is fetched by FullCalendar on every
		// pan/view change, hitting the same range repeatedly; skip the
		// component-tree load + recurrence expansion in collectCalendarEvents
		// entirely when the collection hasn't changed since the client's cached
		// copy. A single findById is much cheaper than that full listing.
		const collection = yield* collections.findById(collectionId);
		const pageCache = yield* PageCacheService;
		const etag = yield* pageEtag(pageCache.startupToken, {
			endpoint: "calendar-events",
			collectionId,
			start: ctx.url.searchParams.get("start"),
			end: ctx.url.searchParams.get("end"),
			synctoken: Option.getOrNull(Option.map(collection, (c) => c.synctoken)),
			updatedAt: Option.getOrNull(
				Option.map(collection, (c) => c.updatedAt?.toString() ?? null),
			),
			// A tier change (e.g. free_busy -> view) doesn't touch the
			// collection's own updatedAt/synctoken, so it must be part of the
			// fingerprint itself — otherwise a caller whose access level just
			// changed could get a stale 304 built from their previous tier's
			// cached body.
			hasFullRead,
		});
		const notModified = notModifiedPageResponse(ctx.headers, etag);
		if (notModified !== undefined) {
			return notModified;
		}

		const views = yield* collectCalendarEvents(
			collectionId,
			rangeStart,
			rangeEnd,
		);
		const visibleViews = hasFullRead
			? views
			: views.map((ev) => applyVisibilityToEventView(ev, "free_busy"));
		const events = visibleViews.map((ev) =>
			toFullCalendarEvent(ev, hasFullRead),
		);

		return withPageCacheHeaders(
			new Response(JSON.stringify(events), {
				status: 200,
				headers: { "Content-Type": "application/json; charset=utf-8" },
			}),
			etag,
		);
	});
