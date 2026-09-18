import type { VNode } from "preact";
import { Button, LinkButton } from "../components/button.tsx";
import { CopyButton, CopyField } from "../components/copy.tsx";
import {
	Badge,
	Card,
	type Column,
	EmptyState,
	Table,
} from "../components/display.tsx";
import { Checkbox, Field, TextInput } from "../components/form/form.tsx";
import { Select } from "../components/form/select.tsx";
import { IconPlus } from "../components/icons.tsx";
import { Breadcrumb, PageHeader } from "../components/page-header.tsx";

import {
	CALENDAR_POPOVER_BODY_ID,
	CALENDAR_POPOVER_ID,
	CalendarPopoverHeader,
} from "./calendar/popover.tsx";

// ---------------------------------------------------------------------------
// Feeds — public read-only iCalendar share links (each a long random token).
// Calendar-scoped: reached from the Calendar menu.
// ---------------------------------------------------------------------------

// Feeds hang off the calendar section, so every trail starts there
const CalendarCrumb = ({
	items,
}: {
	items: ReadonlyArray<{ label: string; href?: string }>;
}) => (
	<Breadcrumb items={[{ label: "Calendar", href: "/ui/calendar" }, ...items]} />
);

const VISIBILITY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
	{ value: "all", label: "Full details" },
	{ value: "limited", label: "Title only" },
	{ value: "free_busy", label: "Busy only" },
];

const VisibilitySelect = ({
	calendarId,
	selected,
}: {
	calendarId: string;
	selected: string;
}) => (
	<Select
		name={`visibility:${calendarId}`}
		aria-label="Visibility"
		options={VISIBILITY_OPTIONS}
		value={selected}
		class="w-auto text-xs"
	/>
);

// --- List ------------------------------------------------------------------

export interface FeedListRow {
	readonly id: string;
	readonly displayName: string;
	readonly enabled: boolean;
	readonly expiresAt: string | null;
	readonly calendarCount: number;
	readonly feedUrl: string;
}

const FEED_COLUMNS: ReadonlyArray<Column<FeedListRow>> = [
	{
		header: "Name",
		cell: (f) => (
			<a
				href={`/ui/feeds/${f.id}`}
				class="font-medium text-fg hover:text-muted"
			>
				{f.displayName}
			</a>
		),
	},
	{
		header: "Calendars",
		cell: (f) => <span class="text-muted">{f.calendarCount}</span>,
	},
	{
		header: "Status",
		cell: (f) => (
			<>
				<Badge tone={f.enabled ? "success" : "neutral"}>
					{f.enabled ? "enabled" : "disabled"}
				</Badge>
				{f.expiresAt ? (
					<span class="ml-2 text-subtle text-xs">expires {f.expiresAt}</span>
				) : null}
			</>
		),
	},
	{
		header: "",
		align: "right",
		shrink: true,
		cell: (f) => (
			<div class="whitespace-nowrap">
				<a href={f.feedUrl} class="link mr-3" title="Open feed">
					Open
				</a>
				<a href={`/ui/feeds/${f.id}`} class="link">
					Edit
				</a>
			</div>
		),
	},
];

export const FeedsListPage = ({
	feeds,
	variant = "page",
}: {
	feeds: ReadonlyArray<FeedListRow>;
	variant?: "page" | "popover";
}): VNode => {
	const popover = variant === "popover";
	return (
		<div class="space-y-6">
			{popover ? (
				<CalendarPopoverHeader title="Feeds" />
			) : (
				<PageHeader
					title="Feeds"
					subtitle="Public read-only iCalendar links, each protected by a random token."
					actions={
						<LinkButton href="/ui/feeds/new" variant="primary">
							<IconPlus class="size-4" />
							New feed
						</LinkButton>
					}
				/>
			)}
			{popover && (
				<LinkButton href="/ui/feeds/new" variant="primary" size="sm">
					<IconPlus class="size-4" />
					New feed
				</LinkButton>
			)}

			<Table
				columns={FEED_COLUMNS}
				rows={feeds}
				getKey={(f) => f.id}
				empty={
					<EmptyState
						title="No feeds yet."
						action={
							<LinkButton href="/ui/feeds/new" variant="primary" size="sm">
								<IconPlus class="size-4" />
								New feed
							</LinkButton>
						}
					/>
				}
			/>
		</div>
	);
};

// --- Calendar-popover quick-add ---------------------------------------------

export interface CalendarFeedMembership {
	readonly feedId: string;
	readonly displayName: string;
	readonly visibility: string;
}

export interface CalendarFeedOption {
	readonly id: string;
	readonly displayName: string;
}

/** Shown inside a calendar's edit popover: which feeds already include this
 * calendar, and a quick way to add it to another existing feed. Creating a
 * brand-new feed containing this calendar links out to /ui/feeds/new. */
export const CalendarFeedsSection = ({
	calendarId,
	memberFeeds,
	addableFeeds,
	addUrl,
}: {
	calendarId: string;
	memberFeeds: ReadonlyArray<CalendarFeedMembership>;
	addableFeeds: ReadonlyArray<CalendarFeedOption>;
	addUrl: string;
}): VNode => (
	<div class="space-y-3">
		{memberFeeds.length > 0 ? (
			<ul class="space-y-1 text-sm">
				{memberFeeds.map((f) => (
					<li class="flex items-center justify-between">
						<a href={`/ui/feeds/${f.feedId}`} class="link">
							{f.displayName}
						</a>
						<span class="text-subtle text-xs">{f.visibility}</span>
					</li>
				))}
			</ul>
		) : (
			<EmptyState title="Not part of any feed yet." />
		)}
		{addableFeeds.length > 0 && (
			<form
				method="POST"
				action={addUrl}
				hx-post={addUrl}
				hx-target={`#${CALENDAR_POPOVER_BODY_ID}`}
				hx-swap="innerHTML"
				class="flex items-center gap-2"
			>
				<input type="hidden" name="returnTo" value="/ui/calendar" />
				<Select
					name="feedId"
					required
					aria-label="Feed"
					class="flex-1 text-xs"
					options={[
						{ value: "", label: "Add to feed…" },
						...addableFeeds.map((f) => ({
							value: f.id,
							label: f.displayName,
						})),
					]}
				/>
				<VisibilitySelect calendarId={calendarId} selected="all" />
				<Button type="submit" size="sm">
					Add
				</Button>
			</form>
		)}
		<a
			href={`/ui/feeds/new?calendar=${calendarId}`}
			target="_blank"
			rel="noopener"
			hx-get={`/ui/feeds/new?calendar=${calendarId}`}
			hx-target={`#${CALENDAR_POPOVER_BODY_ID}`}
			hx-swap="innerHTML"
			class="link text-xs"
		>
			Create a new feed with this calendar
		</a>
	</div>
);

// --- New -------------------------------------------------------------------

export interface FeedCalendarOption {
	readonly id: string;
	readonly displayName: string;
}

export const FeedNewPage = ({
	calendars,
	preselectedCalendarId,
	variant = "page",
}: {
	calendars: ReadonlyArray<FeedCalendarOption>;
	/** Pre-checks one calendar's checkbox — used when arriving from a
	 * calendar's own edit popover ("create a new feed with this calendar"). */
	preselectedCalendarId?: string;
	readonly variant?: "page" | "popover";
}): VNode => {
	const popover = variant === "popover";
	return (
		<div class={popover ? "space-y-6" : "mx-auto max-w-2xl space-y-6"}>
			{popover ? (
				<CalendarPopoverHeader title="New feed" />
			) : (
				<div>
					<CalendarCrumb
						items={[
							{ label: "Feeds", href: "/ui/feeds" },
							{ label: "New feed" },
						]}
					/>
					<PageHeader title="New feed" />
				</div>
			)}

			<Card>
				<form method="POST" action="/ui/api/feeds/create" class="space-y-4">
					{popover && (
						<input type="hidden" name="returnTo" value="/ui/calendar" />
					)}
					<Field for="displayName" label="Display name">
						<TextInput
							id="displayName"
							name="displayName"
							placeholder="e.g. Work calendar"
						/>
					</Field>

					<Field for="expiresAt" label="Expires at (optional ISO instant)">
						<TextInput
							id="expiresAt"
							name="expiresAt"
							placeholder="2026-12-31T00:00:00Z"
						/>
					</Field>

					<fieldset class="space-y-2">
						<legend class="form-label mb-1">Calendars to include</legend>
						{calendars.length > 0 ? (
							calendars.map((c) => (
								<div class="flex items-center gap-3 py-1">
									<Checkbox
										id={`cal-${c.id}`}
										label={c.displayName}
										name="calendar"
										value={c.id}
										checked={c.id === preselectedCalendarId}
										class="flex-1"
									/>
									<VisibilitySelect calendarId={c.id} selected="all" />
								</div>
							))
						) : (
							<EmptyState title="You don't own any calendars yet." />
						)}
					</fieldset>

					<div class="flex items-center gap-3">
						<Button type="submit" variant="primary">
							Create feed
						</Button>
						{popover && (
							<Button commandfor={CALENDAR_POPOVER_ID} command="request-close">
								Cancel
							</Button>
						)}
					</div>
				</form>
			</Card>
		</div>
	);
};

// --- Edit ------------------------------------------------------------------

export interface FeedEditCalendar {
	readonly id: string;
	readonly displayName: string;
	readonly linked: boolean;
	readonly visibility: string;
	readonly embedEnabled: boolean;
}

export interface FeedEditView {
	readonly id: string;
	readonly displayName: string;
	readonly enabled: boolean;
	readonly expiresAt: string;
	/** Absolute, shareable feed URL (shown + copyable). */
	readonly feedShareUrl: string;
	/** Absolute base URL for the public embed widget (see EmbedConfig). Only
	 * meaningful for calendars with `embedEnabled`. */
	readonly embedWidgetUrl: string;
}

export interface FeedEditPageProps {
	readonly feed: FeedEditView;
	readonly calendars: ReadonlyArray<FeedEditCalendar>;
	/** Whether EMBED_CALENDAR_WIDGET_ENABLED is set server-wide — the toggle
	 * below is always shown, but the widget itself 404s until this is on. */
	readonly embedFeatureEnabled: boolean;
}

export const FeedEditPage = ({
	feed,
	calendars,
	embedFeatureEnabled,
}: FeedEditPageProps): VNode => (
	<div class="mx-auto max-w-2xl space-y-6">
		<div>
			<CalendarCrumb
				items={[
					{ label: "Feeds", href: "/ui/feeds" },
					{ label: feed.displayName || "Feed" },
				]}
			/>
			<PageHeader
				title={feed.displayName || "Feed"}
				actions={
					<form
						method="POST"
						action={`/ui/api/feeds/${feed.id}/delete`}
						data-confirm="Delete this feed? The URL will stop working immediately."
					>
						<Button type="submit" variant="danger" size="sm">
							Delete
						</Button>
					</form>
				}
			/>
		</div>

		<Card class="space-y-3">
			<CopyField label="Feed URL" value={feed.feedShareUrl} />
			<form
				method="POST"
				action={`/ui/api/feeds/${feed.id}/regenerate`}
				data-confirm="Regenerate the token? The current URL will stop working."
			>
				<button type="submit" class="link text-xs">
					Regenerate token
				</button>
			</form>
		</Card>

		{calendars.some((c) => c.embedEnabled) && (
			<Card class="space-y-3">
				<h2 class="font-semibold text-fg text-sm">Embed snippet</h2>
				<p class="text-muted text-sm">
					Paste this into any page to show a read-only calendar widget. No login
					required — anyone with this URL can view it.
					{!embedFeatureEnabled && (
						<>
							{" "}
							Calendar embedding is currently disabled on this server (
							<code>EMBED_CALENDAR_WIDGET_ENABLED</code>); the widget will not
							load until an admin enables it.
						</>
					)}
				</p>
				<div class="flex items-stretch gap-2">
					<textarea
						readOnly
						rows={2}
						class="block min-w-0 flex-1 select-all resize-none overflow-x-auto rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-fg text-xs"
					>
						{`<iframe src="${feed.embedWidgetUrl}" title="${feed.displayName || "Calendar"}" style="border:0;width:100%;height:600px" loading="lazy"></iframe>`}
					</textarea>
					<CopyButton
						value={`<iframe src="${feed.embedWidgetUrl}" title="${feed.displayName || "Calendar"}" style="border:0;width:100%;height:600px" loading="lazy"></iframe>`}
						label="embed snippet"
					/>
				</div>
			</Card>
		)}

		<Card>
			<form
				method="POST"
				action={`/ui/api/feeds/${feed.id}/update`}
				class="space-y-4"
			>
				<Field for="displayName" label="Display name">
					<TextInput
						id="displayName"
						name="displayName"
						value={feed.displayName}
					/>
				</Field>

				<Field for="expiresAt" label="Expires at (optional ISO instant)">
					<TextInput
						id="expiresAt"
						name="expiresAt"
						value={feed.expiresAt}
						placeholder="2026-12-31T00:00:00Z"
					/>
				</Field>

				<Checkbox
					id="enabled"
					label="Enabled"
					name="enabled"
					checked={feed.enabled}
				/>

				<fieldset class="space-y-2">
					<legend class="form-label mb-1">Calendars</legend>
					{calendars.map((c) => (
						<div class="flex items-center gap-3 py-1">
							<Checkbox
								id={`cal-${c.id}`}
								label={c.displayName}
								name="calendar"
								value={c.id}
								checked={c.linked}
								class="flex-1"
							/>
							<VisibilitySelect calendarId={c.id} selected={c.visibility} />
							<Checkbox
								id={`embed-${c.id}`}
								label="Embed"
								name={`embed:${c.id}`}
								checked={c.embedEnabled}
								title="Show this calendar in the public, no-login embed widget"
								class="text-muted text-xs"
							/>
						</div>
					))}
				</fieldset>

				<Button type="submit" variant="primary">
					Save changes
				</Button>
			</form>
		</Card>
	</div>
);
