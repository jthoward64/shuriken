import { AssetTags, CALENDAR_ASSETS } from "../../assets.tsx";
import { contrastTextColor } from "../../color-contrast.ts";
import {
	IconChevronDown,
	IconChevronLeft,
	IconChevronRight,
	IconEdit,
	IconPlus,
	IconSpinner,
} from "../../icons.tsx";
import { buttonClass, InlineModalPopover } from "../../ui.tsx";
import { CollectionNewPage } from "../collections.tsx";
import { SidebarShell } from "../sidebar-shell.tsx";
import type {
	HolidayPresetView,
	SyncIntervalOption,
} from "../subscriptions.tsx";
import { SubscriptionsNewPage } from "../subscriptions.tsx";
import { EventHoverCardContainer } from "./event-hover-card.tsx";
import {
	EditEventPopoverContainer,
	NEW_EVENT_POPOVER_ID,
	NewEventPopover,
} from "./event-popovers.tsx";
import {
	CALENDAR_POPOVER_BODY_ID,
	CALENDAR_POPOVER_ID,
	CalendarPopoverContainer,
	CREATE_CALENDAR_POPOVER_ID,
	SUBSCRIBE_CALENDAR_POPOVER_ID,
} from "./popover.tsx";

// ---------------------------------------------------------------------------
// Calendar viewer page (JSX). A left sidebar (new-event button + a checkbox
// list of calendars, with import/export pinned at the bottom) sits beside the
// main content: FullCalendar, progressively enhanced over a server-rendered
// month list.
//
// Multi-calendar overlay: each calendar row has a visibility checkbox; the JS
// path registers one FullCalendar event source per checked calendar (each
// colour-coded), and the no-JS fallback merges every visible calendar's events
// into one colour-tagged list. The calendar *name* is a link that makes that
// calendar the ACTIVE one — the single target of New event / Import / Export
// (which stay per-collection, so no new routes). Hiding the active calendar
// hands "active" off to the first calendar still shown.
//
// URL state: `collection` = active id; `cal` (repeated) = the visible set;
// `cals=1` marks an explicit selection; `month` (YYYY-MM) keeps the fallback
// list, its prev/next nav, and FullCalendar's initialDate in sync.
// ---------------------------------------------------------------------------

/** Synthetic id for the "Shared events" pseudo-calendar — individually-shared
 * VEVENT instances not covered by an owned/shared calendar. Not a real
 * `dav_collection` row, so it can never become the active (write-target)
 * calendar; its event feed lives at a dedicated endpoint (see `sources`
 * below) rather than `/ui/api/calendar/:id/events`. */
export const SHARED_EVENTS_CALENDAR_ID = "shared-events";
export const SHARED_EVENTS_COLOR = "#6b7280";

export interface CalendarOption {
	readonly id: string;
	readonly displayName: string;
	/** Resolved calendar colour as CSS `#RRGGBB`. */
	readonly color: string;
	/** Whether this calendar's events are shown (checkbox state). */
	readonly visible: boolean;
	/** The active calendar — target of new/import/export. */
	readonly active: boolean;
	/** Owner's slug when shared with the caller; null when the caller owns it
	 * or it's the synthetic {@link SHARED_EVENTS_CALENDAR_ID} entry. */
	readonly ownerSlug: string | null;
	/** Whether the caller can create/edit events on this calendar. Always
	 * false for the synthetic entry. */
	readonly writable: boolean;
}

export interface CalendarEventListItem {
	readonly id: string;
	/** Owning calendar (events come from every visible calendar now). */
	readonly collectionId: string;
	readonly title: string;
	/** Owning calendar's colour as CSS `#RRGGBB`. */
	readonly color: string;
	/** Pre-formatted date/time for display (computed in the handler). */
	readonly when: string;
	/** Human recurrence label (e.g. "Repeats weekly") or null. */
	readonly recurrence: string | null;
	/** False for a free-busy-only shared event — the edit route requires
	 * DAV:read and would 403, so the row's click behaves like hover (shows
	 * the read-only preview) instead of opening the edit dialog. */
	readonly readable: boolean;
}

export interface CalendarViewProps {
	readonly calendars: ReadonlyArray<CalendarOption>;
	readonly hasCalendar: boolean;
	/** Active calendar id — target of new/import/export. */
	readonly activeId: string;
	/** The current user's principal id — the owner of newly created calendars. */
	readonly selfPrincipalId: string;
	/** Ids of the currently visible calendars (for nav-link state). */
	readonly visibleIds: ReadonlyArray<string>;
	/** Selected month, `YYYY-MM`. */
	readonly monthValue: string;
	/** Human month label, e.g. "July 2026". */
	readonly monthLabel: string;
	readonly prevMonth: string;
	readonly nextMonth: string;
	/** First day of the selected month, `YYYY-MM-DD` — FullCalendar initialDate. */
	readonly monthStartIso: string;
	readonly events: ReadonlyArray<CalendarEventListItem>;
	/** Holiday presets + sync-interval options for the inline Add-calendar →
	 * Subscribe dialog (always once-a-day default — presets are only reachable
	 * from the standalone Subscribe page). */
	readonly subscribePresets: ReadonlyArray<HolidayPresetView>;
	readonly subscribeIntervals: ReadonlyArray<SyncIntervalOption>;
}

const Swatch = ({ color }: { color: string }) => (
	<span
		class="inline-block h-3 w-3 shrink-0 rounded-full ring-1 ring-line"
		style={`background-color:${color}`}
		aria-hidden="true"
	/>
);

// Build a `/ui/calendar` URL preserving the active calendar, the visible set,
// and the month. Used by the month nav and the calendar-switch links.
const calHref = (
	activeId: string,
	visibleIds: ReadonlyArray<string>,
	month: string,
): string => {
	const p = new URLSearchParams();
	p.set("collection", activeId);
	for (const id of visibleIds) {
		p.append("cal", id);
	}
	p.set("cals", "1");
	p.set("month", month);
	return `/ui/calendar?${p.toString()}`;
};

// --- Sidebar ---------------------------------------------------------------

const NewEventButton = ({ disabled }: { disabled: boolean }) => (
	<button
		type="button"
		commandfor={disabled ? undefined : NEW_EVENT_POPOVER_ID}
		command={disabled ? undefined : "show-modal"}
		disabled={disabled}
		title={disabled ? "Read-only calendar" : undefined}
		class={buttonClass("primary", "w-full")}
	>
		<IconPlus class="h-4 w-4" />
		New event
	</button>
);

// The calendar list — a GET form so no-JS users can toggle visibility and hit
// Apply; the calendar script instead adds/removes FullCalendar event sources
// live on change (and the Apply button is hidden once JS marks the document).
const CalendarList = ({
	calendars,
	activeId,
	visibleIds,
	monthValue,
}: {
	calendars: ReadonlyArray<CalendarOption>;
	activeId: string;
	visibleIds: ReadonlyArray<string>;
	monthValue: string;
}) => (
	<form method="GET" action="/ui/calendar" class="space-y-2">
		<input type="hidden" name="collection" value={activeId} />
		<input type="hidden" name="month" value={monthValue} />
		<input type="hidden" name="cals" value="1" />
		<div class="flex items-center justify-between px-1">
			<h2 class="text-xs font-semibold uppercase tracking-wider text-subtle">
				Calendars
			</h2>
			{/* No-JS visibility apply; JS toggles sources live instead. */}
			<button
				type="submit"
				data-nojs-only
				class={buttonClass("secondary", "btn-sm")}
			>
				Apply
			</button>
		</div>
		<ul class="space-y-0.5" data-reorder-list data-collection-type="calendar">
			{calendars.map((c) => {
				// Switching active always keeps that calendar visible. The synthetic
				// "Shared events" entry has no owning collection, so it can never
				// become active — its name renders as plain text, not a switch link.
				const isSynthetic = c.id === SHARED_EVENTS_CALENDAR_ID;
				// Only the caller's own calendars can be reordered/edited/deleted from
				// here; shared (and the synthetic) entries are read-only in that sense.
				const mutable = c.ownerSlug === null && !isSynthetic;
				const switchTo = visibleIds.includes(c.id)
					? visibleIds
					: [...visibleIds, c.id];
				const url = isSynthetic
					? `/ui/api/calendar/${SHARED_EVENTS_CALENDAR_ID}/events`
					: `/ui/api/calendar/${c.id}/events`;
				return (
					<li
						key={c.id}
						data-reorder-item={mutable ? true : undefined}
						data-collection-id={mutable ? c.id : undefined}
						class={`flex items-center gap-2 rounded-md px-2 py-1.5 ${
							c.active ? "bg-surface-2" : "hover:bg-surface-2"
						}`}
					>
						<input
							type="checkbox"
							name="cal"
							value={c.id}
							checked={c.visible}
							data-cal-toggle
							data-cal-id={c.id}
							data-cal-url={url}
							data-cal-color={c.color}
							data-cal-text-color={contrastTextColor(c.color)}
							aria-label={`Show ${c.displayName}`}
							class="shrink-0"
						/>
						{isSynthetic ? (
							<span class="flex min-w-0 flex-1 items-center gap-2">
								<Swatch color={c.color} />
								<span data-cal-name class="truncate text-sm text-muted">
									{c.displayName}
								</span>
							</span>
						) : (
							<a
								href={calHref(c.id, switchTo, monthValue)}
								data-cal-nav
								data-cal-switch
								data-switch-id={c.id}
								aria-current={c.active ? "true" : undefined}
								class="flex min-w-0 flex-1 items-center gap-2"
							>
								<Swatch color={c.color} />
								<span
									data-cal-name
									class={`truncate text-sm ${
										c.active ? "font-semibold text-fg" : "text-muted"
									}`}
								>
									{c.displayName}
								</span>
							</a>
						)}
						{c.ownerSlug !== null && (
							<span class="badge shrink-0" title={`Shared by ${c.ownerSlug}`}>
								{c.ownerSlug}
							</span>
						)}
						{mutable && (
							<>
								<a
									href={`/ui/collections/${c.id}`}
									target="_blank"
									rel="noopener"
									hx-get={`/ui/collections/${c.id}`}
									hx-target={`#${CALENDAR_POPOVER_BODY_ID}`}
									hx-swap="innerHTML"
									data-popover={CALENDAR_POPOVER_ID}
									aria-label={`Edit ${c.displayName}`}
									class="shrink-0 rounded p-0.5 text-subtle hover:bg-surface hover:text-fg"
								>
									<IconEdit class="h-3.5 w-3.5" />
								</a>
								{/* No-JS reorder fallback: real form submits (formmethod/formaction
								    override the enclosing GET form). Hidden once JS marks the
								    document — the reorder script drags `[data-reorder-item]` rows
								    instead. */}
								<button
									type="submit"
									formmethod="POST"
									formaction={`/ui/api/collections/${c.id}/move/up`}
									data-nojs-only
									aria-label={`Move ${c.displayName} up`}
									class="shrink-0 rounded p-0.5 text-subtle hover:bg-surface hover:text-fg"
								>
									<IconChevronDown class="h-3.5 w-3.5 rotate-180" />
								</button>
								<button
									type="submit"
									formmethod="POST"
									formaction={`/ui/api/collections/${c.id}/move/down`}
									data-nojs-only
									aria-label={`Move ${c.displayName} down`}
									class="shrink-0 rounded p-0.5 text-subtle hover:bg-surface hover:text-fg"
								>
									<IconChevronDown class="h-3.5 w-3.5" />
								</button>
							</>
						)}
					</li>
				);
			})}
		</ul>
		<p class="px-1 text-xs text-subtle">
			The highlighted calendar is where new events, imports, and exports go.
		</p>
	</form>
);

// "Add calendar" — an inline-expanding <details> (no absolute panel, so it never
// clips inside the scrollable list) offering Create new / Subscribe. Both
// forms are rendered inline elsewhere on this page (their own dialog), so
// both open natively via commandfor/command="show-modal" with no JS.
const AddCalendarMenu = () => {
	const itemClass =
		"block w-full rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-surface-2";
	return (
		// Pinned to the bottom of the list region; opens upward (flex-col-reverse)
		// so the options never run past the divider.
		<details class="mt-auto flex flex-col-reverse">
			<summary
				class={buttonClass(
					"secondary",
					"w-full cursor-pointer list-none marker:hidden [&::-webkit-details-marker]:hidden",
				)}
			>
				<IconPlus class="h-4 w-4" />
				Add calendar
			</summary>
			<div class="mb-1 space-y-0.5">
				<button
					type="button"
					commandfor={CREATE_CALENDAR_POPOVER_ID}
					command="show-modal"
					class={itemClass}
				>
					Create new
				</button>
				<button
					type="button"
					commandfor={SUBSCRIBE_CALENDAR_POPOVER_ID}
					command="show-modal"
					class={itemClass}
				>
					Subscribe
				</button>
			</div>
		</details>
	);
};

const ImportForm = ({
	activeId,
	disabled,
}: {
	activeId: string;
	disabled: boolean;
}) => (
	<form
		method="POST"
		action={`/ui/api/calendar/${activeId}/import`}
		enctype="multipart/form-data"
		hx-post={`/ui/api/calendar/${activeId}/import`}
		hx-encoding="multipart/form-data"
		hx-target="#import-result"
		hx-swap="innerHTML"
		data-longop
		class="space-y-2"
	>
		<div class="flex items-center gap-2">
			<label
				class={buttonClass(
					"secondary",
					`flex-1 cursor-pointer ${disabled ? "pointer-events-none opacity-50" : ""}`,
				)}
				title={disabled ? "Read-only calendar" : undefined}
			>
				Import .ics
				<input
					id="cal-import-file"
					type="file"
					name="file"
					accept=".ics,text/calendar"
					disabled={disabled}
					class="hidden"
				/>
			</label>
			<select
				name="mode"
				class="form-select w-auto text-xs"
				aria-label="How to handle duplicate events"
				title="How to handle duplicate events"
			>
				<option value="error">Conflict</option>
				<option value="skip">Skip</option>
				<option value="merge">Replace</option>
			</select>
		</div>
		{/* No-JS submit; JS auto-submits on file pick (see enhancement script). */}
		<button
			type="submit"
			disabled={disabled}
			data-nojs-only
			class={buttonClass("secondary", "btn-sm w-full")}
		>
			Upload
		</button>
		<span class="htmx-indicator items-center gap-1 text-sm text-muted">
			<IconSpinner class="h-4 w-4 animate-spin" />
			Importing…
		</span>
	</form>
);

const ExportButton = ({ activeId }: { activeId: string }) => (
	<>
		<a
			id="cal-export"
			href={`/ui/calendar/${activeId}/export.ics`}
			class={buttonClass("secondary", "w-full")}
		>
			Export .ics
		</a>
		<span
			id="cal-export-indicator"
			class="hidden items-center [&.is-busy]:inline-flex text-sm text-muted"
		>
			<IconSpinner class="mr-1 h-4 w-4 animate-spin" />
			Preparing…
		</span>
	</>
);

// Feeds (public share links you publish) — lazy: with JS, htmx loads the list
// into the shared popover + opens it. Without JS, opens in a new tab instead
// of navigating this embedded page away.
const FeedsButton = () => (
	<a
		href="/ui/feeds"
		target="_blank"
		rel="noopener"
		hx-get="/ui/feeds"
		hx-target={`#${CALENDAR_POPOVER_BODY_ID}`}
		hx-swap="innerHTML"
		data-popover={CALENDAR_POPOVER_ID}
		class={buttonClass("secondary", "w-full")}
	>
		Feeds
	</a>
);

// --- Main content ----------------------------------------------------------

const MonthNav = ({
	activeId,
	visibleIds,
	monthLabel,
	prevMonth,
	nextMonth,
}: {
	activeId: string;
	visibleIds: ReadonlyArray<string>;
	monthLabel: string;
	prevMonth: string;
	nextMonth: string;
}) => (
	<div class="flex items-center justify-between gap-3">
		<a
			href={calHref(activeId, visibleIds, prevMonth)}
			data-cal-nav
			class={buttonClass("ghost", "btn-sm")}
		>
			<IconChevronLeft class="h-4 w-4" />
			<span class="sr-only">Previous month</span>
		</a>
		<span class="text-sm font-semibold text-fg">{monthLabel}</span>
		<a
			href={calHref(activeId, visibleIds, nextMonth)}
			data-cal-nav
			class={buttonClass("ghost", "btn-sm")}
		>
			<span class="sr-only">Next month</span>
			<IconChevronRight class="h-4 w-4" />
		</a>
	</div>
);

const EventList = ({
	events,
}: {
	events: ReadonlyArray<CalendarEventListItem>;
}) => {
	if (events.length === 0) {
		return (
			<p class="px-1 py-6 text-center text-sm text-muted">
				No events this month.
			</p>
		);
	}
	return (
		<ul class="divide-y divide-line">
			{events.map((ev) => {
				// Synthetic-calendar rows are individually-shared, foreign-owned
				// events with no edit route — link through to their ACL page instead.
				const isShared = ev.collectionId === SHARED_EVENTS_CALENDAR_ID;
				const href = isShared
					? `/ui/instances/${ev.id}/acl`
					: `/ui/calendar/${ev.collectionId}/events/${ev.id}`;
				return (
					<li key={ev.id}>
						{/* With JS, hover or click loads the read-only preview into the
						    hover card (calendar.client.ts) instead of navigating; its Edit
						    button opens the real edit dialog. Without JS (or for
						    shared-events rows, which have no edit route), the link opens
						    in a new tab instead of navigating this embedded page away. */}
						<a
							href={href}
							target="_blank"
							rel="noopener"
							data-hover-preview={isShared ? undefined : `${href}/preview`}
							data-editable={isShared || !ev.readable ? undefined : "true"}
							class="flex items-start gap-3 px-1 py-3 transition-colors hover:bg-surface-2"
						>
							<span class="mt-1.5">
								<Swatch color={ev.color} />
							</span>
							<span class="min-w-0 flex-1">
								<span class="block truncate font-medium text-fg">
									{ev.title}
								</span>
								<span class="block text-sm text-muted">{ev.when}</span>
							</span>
							{ev.recurrence && (
								<span class="badge shrink-0">{ev.recurrence}</span>
							)}
						</a>
					</li>
				);
			})}
		</ul>
	);
};

export const CalendarViewPage = (props: CalendarViewProps) => {
	const {
		calendars,
		hasCalendar,
		activeId,
		selfPrincipalId,
		visibleIds,
		monthValue,
		monthLabel,
		prevMonth,
		nextMonth,
		monthStartIso,
		events,
		subscribePresets,
		subscribeIntervals,
	} = props;

	if (!hasCalendar) {
		return (
			<div class="space-y-6">
				<h1 class="page-title">Calendar</h1>
				<p class="text-sm text-muted">No calendars available.</p>
			</div>
		);
	}

	// Visible calendars (incl. the active one) drive FullCalendar's initial
	// event sources — serialised for the boot script (see calendar.client.ts).
	const sources = calendars
		.filter((c) => c.visible)
		.map((c) => ({
			id: c.id,
			url:
				c.id === SHARED_EVENTS_CALENDAR_ID
					? `/ui/api/calendar/${SHARED_EVENTS_CALENDAR_ID}/events`
					: `/ui/api/calendar/${c.id}/events`,
			color: c.color,
			textColor: contrastTextColor(c.color),
		}));

	// No real calendar is active when the caller has nothing owned/shared but
	// does have individually-shared events (synthetic-only case) — New
	// event/Import/Export have no valid write target then.
	const hasActiveCalendar = activeId !== "";
	const activeWritable =
		calendars.find((c) => c.id === activeId)?.writable ?? false;

	return (
		<>
			<SidebarShell
				label="Calendars"
				gap={false}
				top={
					<>
						<NewEventButton disabled={!hasActiveCalendar || !activeWritable} />
						<CalendarList
							calendars={calendars}
							activeId={activeId}
							visibleIds={visibleIds}
							monthValue={monthValue}
						/>
						<AddCalendarMenu />
					</>
				}
				bottom={
					<>
						{hasActiveCalendar && (
							<>
								<ImportForm activeId={activeId} disabled={!activeWritable} />
								<ExportButton activeId={activeId} />
							</>
						)}
						<FeedsButton />
					</>
				}
			>
				<div id="import-result" class="empty:hidden lg:shrink-0" />

				{/* Default content — server-rendered, works with no JS. `data-nojs-only`
			    (see input.css) hides it pre-paint once ui.js marks the document
			    `.js`, so JS users never see it flash before FullCalendar mounts;
			    calendar.js also hides it (belt-and-suspenders, e.g. if ui.js
			    failed to load but calendar.js didn't). Fills the column
			    (scrolling internally) under the layout's fill mode. */}
				<div
					id="cal-fallback"
					data-nojs-only
					class="card card-pad space-y-3 rounded-none lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
				>
					<MonthNav
						activeId={activeId}
						visibleIds={visibleIds}
						monthLabel={monthLabel}
						prevMonth={prevMonth}
						nextMonth={nextMonth}
					/>
					<EventList events={events} />
					<p class="text-xs text-subtle">
						Showing each series once. Enable JavaScript for the full interactive
						calendar with expanded recurrences.
					</p>
				</div>

				{/* Config for calendar.js via data-* (no inline script). `data-sources`
			    is the JSON list of initially-visible calendar feeds. Fills the
			    column height so FullCalendar (height:100% on lg) fits the viewport. */}
				<div
					id="fullcalendar"
					hidden
					class="card card-pad rounded-none lg:min-h-0 lg:flex-1"
					data-active={activeId}
					data-initial-date={monthStartIso}
					data-sources={JSON.stringify(sources)}
				/>

				{/* calendar.js — FullCalendar (core + plugins) inlined by
			    Deno.bundle(), plus our boot script. `defer`, loaded only here.
			    Sourced from CALENDAR_ASSETS so the same list drives the
			    preload header. */}
				<AssetTags assets={CALENDAR_ASSETS} />

				{/* Event popovers — rendered at the page root, outside every form
			    (no nested forms). New is a static blank form for the active
			    calendar; Edit is filled on demand by an HTMX fragment. Skipped
			    when there's no writable active calendar to target. */}
				{hasActiveCalendar && activeWritable && (
					<NewEventPopover collectionId={activeId} />
				)}
				<EditEventPopoverContainer />
				<EventHoverCardContainer />
			</SidebarShell>
			{/* Create calendar — form rendered inline so it opens with no JS. */}
			<InlineModalPopover id={CREATE_CALENDAR_POPOVER_ID}>
				<CollectionNewPage
					ownerType="user"
					ownerDisplayName=""
					createUrl={`/ui/api/users/${selfPrincipalId}/collections/create`}
					backUrl="/ui/calendar"
					variant="popover"
					popoverId={CREATE_CALENDAR_POPOVER_ID}
				/>
			</InlineModalPopover>
			{/* Subscribe — form rendered inline so it opens with no JS, same as
			    Create above. */}
			<InlineModalPopover id={SUBSCRIBE_CALENDAR_POPOVER_ID}>
				<SubscriptionsNewPage
					presets={subscribePresets}
					intervals={subscribeIntervals}
					variant="popover"
					popoverId={SUBSCRIBE_CALENDAR_POPOVER_ID}
				/>
			</InlineModalPopover>
			{/* Feeds — lazily loaded into this shared popover. */}
			<CalendarPopoverContainer />
		</>
	);
};

// --- Import-result fragment (swapped into #import-result) -------------------

export interface CalendarImportResultProps {
	readonly conflict: boolean;
	readonly conflicts?: ReadonlyArray<string>;
	readonly inserted?: number;
	readonly skipped?: number;
	readonly merged?: number;
	readonly total?: number;
}

export const CalendarImportResult = ({
	conflict,
	conflicts = [],
	inserted = 0,
	skipped = 0,
	merged = 0,
	total = 0,
}: CalendarImportResultProps) =>
	conflict ? (
		<div class="space-y-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
			<p class="font-medium text-warning">
				{conflicts.length} item(s) already exist with these UIDs:
			</p>
			<ul class="max-h-32 list-inside list-disc overflow-auto font-mono text-xs text-muted">
				{conflicts.map((c) => (
					<li key={c}>{c}</li>
				))}
			</ul>
			<p class="text-xs text-muted">
				Re-select the file with <strong>Skip duplicates</strong> or{" "}
				<strong>Replace duplicates</strong> to proceed.
			</p>
		</div>
	) : (
		<div class="rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success">
			Imported {inserted} new, replaced {merged}, skipped {skipped}.
			{total > 0 && <span class="text-muted"> ({total} total)</span>}
		</div>
	);
