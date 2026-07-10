/** biome-ignore-all lint/style/noMagicNumbers: date/time component arithmetic */
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import { AppConfigService } from "#src/config.ts";
import type { IrDeadProperties } from "#src/data/ir.ts";
import { resolveCalendarColor, toCssHex } from "#src/domain/calendar-color.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId, type UuidString } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	applyVisibilityToEventView,
	type CalendarEventView,
	collectCalendarEvents,
	collectCalendarEventsForInstances,
} from "#src/http/ui/api/calendar/collect-events.ts";
import {
	filterViewsByRange,
	findUncoveredSharedInstances,
} from "#src/http/ui/api/calendar/shared-instances.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import type { UiPageOpts } from "#src/http/ui/helpers/page-opts.ts";
import { listOwnedAndShared } from "#src/http/ui/helpers/shared-collections.ts";
import {
	notModifiedPageResponse,
	PageCacheService,
	pageEtag,
	withPageCacheHeaders,
} from "#src/http/ui/page-cache/index.ts";
import { CALENDAR_ASSETS } from "#src/http/ui/view/assets.tsx";
import {
	type CalendarEventListItem,
	CalendarViewPage,
	SHARED_EVENTS_CALENDAR_ID,
	SHARED_EVENTS_COLOR,
} from "#src/http/ui/view/pages/calendar/view.tsx";
import { renderPage } from "#src/http/ui/view/render.tsx";
import type { AclRepository } from "#src/services/acl/repository.ts";
import type { AclService } from "#src/services/acl/service.ts";
import type { CalIndexRepository } from "#src/services/cal-index/index.ts";
import type { CollectionRepository } from "#src/services/collection/repository.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import {
	DEFAULT_SYNC_INTERVAL_S,
	HOLIDAY_PRESETS,
	SYNC_INTERVAL_OPTIONS,
} from "#src/services/external-calendar/holiday-presets.ts";
import type { InstanceRepository } from "#src/services/instance/repository.ts";
import type { PrincipalRepository } from "#src/services/principal/repository.ts";

// The inline Add-calendar → Subscribe dialog never carries a `?preset=`
// selection (that's only reachable from the standalone Subscribe page), so
// its sync-interval options always default to once-a-day.
const SUBSCRIBE_INTERVALS = SYNC_INTERVAL_OPTIONS.map((o) => ({
	...o,
	selected: o.seconds === DEFAULT_SYNC_INTERVAL_S,
}));

// ---------------------------------------------------------------------------
// GET /ui/calendar?collection=<id>&month=<YYYY-MM> — calendar viewer.
//
// Renders the chrome plus a server-rendered event list for the selected month
// (the no-JS default; FullCalendar progressively replaces it — see view.tsx).
// `month` defaults to the current month and keeps the fallback list, its
// prev/next nav, and FullCalendar's initialDate in sync.
// ---------------------------------------------------------------------------

const MONTH_NAMES = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
] as const;

// Indexed by Temporal `dayOfWeek` − 1 (ISO: Monday = 1 … Sunday = 7).
const WEEKDAY_NAMES = [
	"Mon",
	"Tue",
	"Wed",
	"Thu",
	"Fri",
	"Sat",
	"Sun",
] as const;

/** Parse a `YYYY-MM` param to a PlainYearMonth; fall back to the current month
 * on absence or malformed input. */
const resolveYearMonth = (raw: string | null): Temporal.PlainYearMonth => {
	if (raw !== null && raw !== "") {
		try {
			return Temporal.PlainYearMonth.from(raw);
		} catch {
			// fall through to current month
		}
	}
	return Temporal.Now.plainDateISO().toPlainYearMonth();
};

const pad2 = (n: number): string => String(n).padStart(2, "0");

const to12Hour = (hour: number, minute: number): string => {
	const period = hour < 12 ? "AM" : "PM";
	const h12 = hour % 12 === 0 ? 12 : hour % 12;
	return `${h12}:${pad2(minute)} ${period}`;
};

/** Human date/time label for the fallback list. */
const formatWhen = (ev: CalendarEventView): string => {
	try {
		if (ev.allDay) {
			const d = Temporal.PlainDate.from(ev.start);
			return `${WEEKDAY_NAMES[d.dayOfWeek - 1]}, ${MONTH_NAMES[d.month - 1]} ${d.day}`;
		}
		const dt = Temporal.PlainDateTime.from(ev.start);
		return `${WEEKDAY_NAMES[dt.dayOfWeek - 1]}, ${MONTH_NAMES[dt.month - 1]} ${dt.day} · ${to12Hour(dt.hour, dt.minute)}`;
	} catch {
		return ev.start;
	}
};

/** Human recurrence label from the raw RRULE (FREQ + INTERVAL). */
const recurrenceLabel = (rruleRaw: string | null): string | null => {
	if (rruleRaw === null) {
		return null;
	}
	let freq = "";
	let interval = 1;
	for (const part of rruleRaw.split(";")) {
		const [k, v] = part.split("=", 2);
		if (k === "FREQ" && v !== undefined) {
			freq = v.toUpperCase();
		} else if (k === "INTERVAL" && v !== undefined) {
			const n = Number.parseInt(v, 10);
			if (Number.isFinite(n) && n > 0) {
				interval = n;
			}
		}
	}
	const unit: Record<string, string> = {
		DAILY: "day",
		WEEKLY: "week",
		MONTHLY: "month",
		YEARLY: "year",
	};
	const u = unit[freq];
	if (u === undefined) {
		return "Repeats";
	}
	return interval === 1 ? `Repeats ${u}ly` : `Every ${interval} ${u}s`;
};

const utcInstant = (date: Temporal.PlainDate): Temporal.Instant =>
	date.toZonedDateTime("UTC").toInstant();

export const calendarViewHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	opts: UiPageOpts = {},
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclRepository
	| AclService
	| AppConfigService
	| CalIndexRepository
	| CollectionRepository
	| ComponentRepository
	| InstanceRepository
	| PageCacheService
	| PrincipalRepository
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;

		const withSharing = yield* listOwnedAndShared(principal, "calendar");
		// `calendars` — real, DB-backed rows only — drives active/write-target
		// resolution exactly as before. The synthetic "Shared events" pseudo-
		// calendar is appended only to the rendered `options` list further down,
		// so it can never become "active" (not even via a crafted `?collection=`).
		const calendars = withSharing.map((c) => c.row);
		const sharingById = new Map(withSharing.map((c) => [c.row.id, c]));

		// Visible set. `cals=1` marks an explicit selection (from the sidebar
		// checkboxes); absent it, every calendar is visible by default.
		const explicitSelection = ctx.url.searchParams.has("cals");
		const requestedVisible = new Set(ctx.url.searchParams.getAll("cal"));
		const isVisible = (id: string): boolean =>
			explicitSelection ? requestedVisible.has(id) : true;

		// Active calendar — target of new/import/export. Prefer the requested one
		// while it is visible; once it has been hidden (its checkbox unticked),
		// hand off to the first still-visible calendar so "active" tracks the
		// selection. Falls back to the requested/first when nothing is visible.
		const requestedActiveId = ctx.url.searchParams.get("collection") ?? "";
		const requestedActive = calendars.find((c) => c.id === requestedActiveId);
		const firstVisible = calendars.find((c) => isVisible(c.id));
		const active =
			requestedActive !== undefined && isVisible(requestedActive.id)
				? requestedActive
				: (firstVisible ?? requestedActive ?? calendars[0]);

		const colorFor = (c: (typeof calendars)[number]): string =>
			toCssHex(
				resolveCalendarColor(
					c.clientProperties as IrDeadProperties | null,
					c.id,
				),
			);

		const yearMonth = resolveYearMonth(ctx.url.searchParams.get("month"));
		const monthStart = yearMonth.toPlainDate({ day: 1 });
		const nextYm = yearMonth.add({ months: 1 });
		const monthEnd = nextYm.toPlainDate({ day: 1 });

		const options: Array<{
			id: string;
			displayName: string;
			color: string;
			visible: boolean;
			active: boolean;
			ownerSlug: string | null;
			writable: boolean;
			hasFullRead: boolean;
		}> = calendars.map((c) => {
			const sharing = sharingById.get(c.id);
			return {
				id: c.id,
				displayName: c.displayName ?? c.slug,
				color: colorFor(c),
				visible: isVisible(c.id),
				active: c.id === active?.id,
				ownerSlug: sharing?.ownerSlug ?? null,
				writable: sharing?.writable ?? true,
				hasFullRead: sharing?.hasFullRead ?? true,
			};
		});

		// Synthetic "Shared events" pseudo-calendar — individually-shared VEVENT
		// instances not covered by an owned/shared calendar. Existence is checked
		// unscoped by date so the sidebar entry doesn't flicker across months.
		const coveredIds = new Set(calendars.map((c) => c.id));
		const uncoveredInstances = yield* findUncoveredSharedInstances(
			principal,
			coveredIds,
		);
		if (uncoveredInstances.length > 0) {
			options.push({
				id: SHARED_EVENTS_CALENDAR_ID,
				displayName: "Shared events",
				color: SHARED_EVENTS_COLOR,
				visible: isVisible(SHARED_EVENTS_CALENDAR_ID),
				active: false,
				ownerSlug: null,
				writable: false,
				// Individually-shared instances have no free-busy tier — always a
				// full DAV:read grant.
				hasFullRead: true,
			});
		}
		const visibleCalendars = options.filter((o) => o.visible);

		// Conditional GET — everything the render depends on (collection set,
		// per-collection synctoken/updatedAt/sortOrder/writable, the individually-
		// shared "uncovered" instances, and the request's own params) is already
		// in hand and cheap to have gathered; if none of it changed since the
		// client's cached copy, skip the expensive per-calendar event queries
		// below entirely rather than only skipping the HTML transfer.
		const pageCache = yield* PageCacheService;
		const etag = yield* pageEtag(pageCache.startupToken, {
			page: "calendar",
			principal: principal.principalId,
			fragment: isHtmxRequest(ctx.headers),
			chrome: opts.chrome ?? "full",
			month: yearMonth.toString(),
			active: requestedActiveId,
			explicitSelection,
			visible: [...requestedVisible].sort(),
			collections: withSharing.map((c) => [
				c.row.id,
				c.row.synctoken,
				c.row.updatedAt?.toString() ?? null,
				c.row.sortOrder,
				c.writable,
				c.hasFullRead,
			]),
			uncovered: uncoveredInstances.map((i) => [i.id, i.etag]),
		});
		const notModified = notModifiedPageResponse(ctx.headers, etag);
		if (notModified !== undefined) {
			return notModified;
		}

		// Fetch this month's events for every visible calendar; the JSON feed
		// still enforces ACL for the JS path regardless of ownership. Each event
		// carries its calendar's colour + id, then the merged set is sorted.
		let events: ReadonlyArray<CalendarEventListItem> = [];
		if (active !== undefined || uncoveredInstances.length > 0) {
			const perCalendar = yield* Effect.forEach(visibleCalendars, (o) => {
				const views =
					o.id === SHARED_EVENTS_CALENDAR_ID
						? collectCalendarEventsForInstances(uncoveredInstances).pipe(
								Effect.map((vs) =>
									filterViewsByRange(
										vs,
										utcInstant(monthStart),
										utcInstant(monthEnd),
									),
								),
							)
						: collectCalendarEvents(
								// Not the synthetic entry (checked above), so this is a real
								// collection id.
								CollectionId(o.id as UuidString),
								utcInstant(monthStart),
								utcInstant(monthEnd),
							);
				return views.pipe(
					Effect.map((vs) =>
						vs.map((ev) => ({
							ev: o.hasFullRead
								? ev
								: applyVisibilityToEventView(ev, "free_busy"),
							collectionId: o.id,
							color: o.color,
							readable: o.hasFullRead,
						})),
					),
				);
			});
			events = perCalendar
				.flat()
				.sort((a, b) =>
					a.ev.start < b.ev.start ? -1 : a.ev.start > b.ev.start ? 1 : 0,
				)
				.map(({ ev, collectionId, color, readable }) => ({
					id: ev.id,
					collectionId,
					title: ev.title,
					color,
					when: formatWhen(ev),
					recurrence: recurrenceLabel(ev.rruleRaw),
					readable,
				}));
		}

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		const hasCalendar = active !== undefined || uncoveredInstances.length > 0;

		const response = yield* renderPage(
			<CalendarViewPage
				calendars={options}
				hasCalendar={hasCalendar}
				activeId={active?.id ?? ""}
				selfPrincipalId={principal.principalId}
				visibleIds={visibleCalendars.map((o) => o.id)}
				monthValue={yearMonth.toString()}
				monthLabel={`${MONTH_NAMES[yearMonth.month - 1]} ${yearMonth.year}`}
				prevMonth={yearMonth.subtract({ months: 1 }).toString()}
				nextMonth={nextYm.toString()}
				monthStartIso={monthStart.toString()}
				events={events}
				subscribePresets={HOLIDAY_PRESETS}
				subscribeIntervals={SUBSCRIBE_INTERVALS}
			/>,
			{
				headers: ctx.headers,
				title: "Calendar",
				nav,
				wide: true,
				fill: true,
				chrome: opts.chrome,
				// Preload the calendar bundle only when it actually renders (i.e.
				// there is a calendar to show — see CalendarViewPage).
				preload: hasCalendar ? CALENDAR_ASSETS : undefined,
			},
		);
		return withPageCacheHeaders(response, etag);
	});
