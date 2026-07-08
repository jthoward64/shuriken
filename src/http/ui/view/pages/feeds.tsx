import type { VNode } from "preact";
import { CopyButton } from "../copy.tsx";
import { IconPlus } from "../icons.tsx";
import { PageHeader } from "../ui.tsx";
import {
	CALENDAR_POPOVER_BODY_ID,
	CALENDAR_POPOVER_ID,
	CalendarPopoverHeader,
} from "./calendar/popover.tsx";

// ---------------------------------------------------------------------------
// Feeds — public read-only iCalendar share links (each a long random token).
// Calendar-scoped: reached from the Calendar menu.
// ---------------------------------------------------------------------------

const CalendarCrumb = ({
	items,
}: {
	items: ReadonlyArray<{ label: string; href?: string }>;
}) => (
	<nav aria-label="Breadcrumb" class="mb-2 flex items-center gap-2 text-sm">
		<a href="/ui/calendar" class="link">
			Calendar
		</a>
		{items.map((it) => (
			<>
				<span class="text-subtle">/</span>
				{it.href ? (
					<a href={it.href} class="link">
						{it.label}
					</a>
				) : (
					<span class="text-muted">{it.label}</span>
				)}
			</>
		))}
	</nav>
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
	<select name={`visibility:${calendarId}`} class="form-select w-auto text-xs">
		{VISIBILITY_OPTIONS.map((o) =>
			o.value === selected ? (
				<option value={o.value} selected>
					{o.label}
				</option>
			) : (
				<option value={o.value}>{o.label}</option>
			),
		)}
	</select>
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
						<a href="/ui/feeds/new" class="btn btn-primary">
							<IconPlus class="h-4 w-4" />
							New feed
						</a>
					}
				/>
			)}
			{popover && (
				<a href="/ui/feeds/new" class="btn btn-primary btn-sm">
					<IconPlus class="h-4 w-4" />
					New feed
				</a>
			)}

			{feeds.length > 0 ? (
				<div class="table-wrap">
					<table class="table">
						<thead>
							<tr>
								<th>Name</th>
								<th>Calendars</th>
								<th>Status</th>
								<th class="w-0" />
							</tr>
						</thead>
						<tbody>
							{feeds.map((f) => (
								<tr>
									<td>
										<a
											href={`/ui/feeds/${f.id}`}
											class="font-medium text-fg hover:text-muted"
										>
											{f.displayName}
										</a>
									</td>
									<td class="text-muted">{f.calendarCount}</td>
									<td class="text-sm">
										<span class={f.enabled ? "badge badge-success" : "badge"}>
											{f.enabled ? "enabled" : "disabled"}
										</span>
										{f.expiresAt && (
											<span class="ml-2 text-xs text-subtle">
												expires {f.expiresAt}
											</span>
										)}
									</td>
									<td class="text-right">
										<a href={f.feedUrl} class="link mr-3" title="Open feed">
											Open
										</a>
										<a href={`/ui/feeds/${f.id}`} class="link">
											Edit
										</a>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				<div class="card card-pad text-center">
					<p class="text-sm text-muted">
						No feeds yet.{" "}
						<a href="/ui/feeds/new" class="link">
							Create one.
						</a>
					</p>
				</div>
			)}
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
						<span class="text-xs text-subtle">{f.visibility}</span>
					</li>
				))}
			</ul>
		) : (
			<p class="text-sm text-muted">Not part of any feed yet.</p>
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
				<select name="feedId" required class="form-select flex-1 text-xs">
					<option value="">Add to feed…</option>
					{addableFeeds.map((f) => (
						<option value={f.id}>{f.displayName}</option>
					))}
				</select>
				<VisibilitySelect calendarId={calendarId} selected="all" />
				<button type="submit" class="btn btn-secondary btn-sm">
					Add
				</button>
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

			<div class="card card-pad">
				<form method="POST" action="/ui/api/feeds/create" class="space-y-4">
					{popover && (
						<input type="hidden" name="returnTo" value="/ui/calendar" />
					)}
					<div class="form-group">
						<label for="displayName" class="form-label">
							Display name
						</label>
						<input
							type="text"
							id="displayName"
							name="displayName"
							placeholder="e.g. Work calendar"
							class="form-input"
						/>
					</div>

					<div class="form-group">
						<label for="expiresAt" class="form-label">
							Expires at (optional ISO instant)
						</label>
						<input
							type="text"
							id="expiresAt"
							name="expiresAt"
							placeholder="2026-12-31T00:00:00Z"
							class="form-input"
						/>
					</div>

					<fieldset class="space-y-2">
						<legend class="form-label mb-1">Calendars to include</legend>
						{calendars.length > 0 ? (
							calendars.map((c) => (
								<div class="flex items-center gap-3 py-1">
									<input
										type="checkbox"
										id={`cal-${c.id}`}
										name="calendar"
										value={c.id}
										checked={c.id === preselectedCalendarId}
										class="rounded"
									/>
									<label for={`cal-${c.id}`} class="flex-1 text-sm">
										{c.displayName}
									</label>
									<VisibilitySelect calendarId={c.id} selected="all" />
								</div>
							))
						) : (
							<p class="text-sm text-muted">You don't own any calendars yet.</p>
						)}
					</fieldset>

					<div class="flex items-center gap-3">
						<button type="submit" class="btn btn-primary">
							Create feed
						</button>
						{popover && (
							<button
								type="button"
								commandfor={CALENDAR_POPOVER_ID}
								command="request-close"
								class="btn btn-secondary"
							>
								Cancel
							</button>
						)}
					</div>
				</form>
			</div>
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
						<button type="submit" class="btn btn-danger btn-sm">
							Delete
						</button>
					</form>
				}
			/>
		</div>

		<div class="card card-pad space-y-3">
			<h2 class="text-sm font-semibold text-fg">Feed URL</h2>
			<div class="flex items-stretch gap-2">
				<code class="block min-w-0 flex-1 select-all overflow-x-auto whitespace-nowrap rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-sm text-fg">
					{feed.feedShareUrl}
				</code>
				<CopyButton value={feed.feedShareUrl} label="feed URL" />
			</div>
			<form
				method="POST"
				action={`/ui/api/feeds/${feed.id}/regenerate`}
				data-confirm="Regenerate the token? The current URL will stop working."
			>
				<button type="submit" class="link text-xs">
					Regenerate token
				</button>
			</form>
		</div>

		{calendars.some((c) => c.embedEnabled) && (
			<div class="card card-pad space-y-3">
				<h2 class="text-sm font-semibold text-fg">Embed snippet</h2>
				<p class="text-sm text-muted">
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
						class="block min-w-0 flex-1 select-all resize-none overflow-x-auto rounded-md border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-fg"
					>
						{`<iframe src="${feed.embedWidgetUrl}" title="${feed.displayName || "Calendar"}" style="border:0;width:100%;height:600px" loading="lazy"></iframe>`}
					</textarea>
					<CopyButton
						value={`<iframe src="${feed.embedWidgetUrl}" title="${feed.displayName || "Calendar"}" style="border:0;width:100%;height:600px" loading="lazy"></iframe>`}
						label="embed snippet"
					/>
				</div>
			</div>
		)}

		<div class="card card-pad">
			<form
				method="POST"
				action={`/ui/api/feeds/${feed.id}/update`}
				class="space-y-4"
			>
				<div class="form-group">
					<label for="displayName" class="form-label">
						Display name
					</label>
					<input
						type="text"
						id="displayName"
						name="displayName"
						value={feed.displayName}
						class="form-input"
					/>
				</div>

				<div class="form-group">
					<label for="expiresAt" class="form-label">
						Expires at (optional ISO instant)
					</label>
					<input
						type="text"
						id="expiresAt"
						name="expiresAt"
						value={feed.expiresAt}
						placeholder="2026-12-31T00:00:00Z"
						class="form-input"
					/>
				</div>

				<div class="flex items-center gap-2">
					{feed.enabled ? (
						<input type="checkbox" id="enabled" name="enabled" checked />
					) : (
						<input type="checkbox" id="enabled" name="enabled" />
					)}
					<label for="enabled" class="text-sm text-fg">
						Enabled
					</label>
				</div>

				<fieldset class="space-y-2">
					<legend class="form-label mb-1">Calendars</legend>
					{calendars.map((c) => (
						<div class="flex items-center gap-3 py-1">
							{c.linked ? (
								<input
									type="checkbox"
									id={`cal-${c.id}`}
									name="calendar"
									value={c.id}
									checked
									class="rounded"
								/>
							) : (
								<input
									type="checkbox"
									id={`cal-${c.id}`}
									name="calendar"
									value={c.id}
									class="rounded"
								/>
							)}
							<label for={`cal-${c.id}`} class="flex-1 text-sm">
								{c.displayName}
							</label>
							<VisibilitySelect calendarId={c.id} selected={c.visibility} />
							<label
								for={`embed-${c.id}`}
								class="flex items-center gap-1.5 text-xs text-muted"
								title="Show this calendar in the public, no-login embed widget"
							>
								{c.embedEnabled ? (
									<input
										type="checkbox"
										id={`embed-${c.id}`}
										name={`embed:${c.id}`}
										checked
										class="rounded"
									/>
								) : (
									<input
										type="checkbox"
										id={`embed-${c.id}`}
										name={`embed:${c.id}`}
										class="rounded"
									/>
								)}
								Embed
							</label>
						</div>
					))}
				</fieldset>

				<button type="submit" class="btn btn-primary">
					Save changes
				</button>
			</form>
		</div>
	</div>
);
