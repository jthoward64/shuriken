import type { VNode } from "preact";
import { IconPlus } from "../icons.tsx";
import { PageHeader } from "../ui.tsx";
import {
	CALENDAR_POPOVER_BODY_ID,
	CALENDAR_POPOVER_ID,
	CalendarPopoverHeader,
} from "./calendar/popover.tsx";

// ---------------------------------------------------------------------------
// Subscriptions — external (read-only) iCalendar feeds the user has subscribed
// to. Calendar-scoped: reached from the Calendar menu.
// ---------------------------------------------------------------------------

export interface SubscriptionRow {
	readonly claimId: string;
	readonly url: string;
	readonly displayName: string;
	readonly color: string | null;
	readonly lastSyncStatus: "never" | "success" | "failure";
	readonly lastSyncAt: string | null;
	readonly lastSyncError: string | null;
}

const CalendarCrumb = ({ title }: { title: string }) => (
	<nav aria-label="Breadcrumb" class="mb-2 flex items-center gap-2 text-sm">
		<a href="/ui/calendar" class="link">
			Calendar
		</a>
		<span class="text-subtle">/</span>
		<span class="text-muted">{title}</span>
	</nav>
);

const SyncStatus = ({ sub }: { sub: SubscriptionRow }) => {
	if (sub.lastSyncAt === null) {
		return <span class="text-subtle">Never synced</span>;
	}
	return (
		<div>
			<span
				class={
					sub.lastSyncStatus === "failure"
						? "badge badge-danger"
						: "badge badge-success"
				}
			>
				{sub.lastSyncStatus}
			</span>
			<span class="ml-2 text-xs text-subtle">{sub.lastSyncAt}</span>
			{sub.lastSyncError && (
				<div class="mt-1 text-xs text-danger">{sub.lastSyncError}</div>
			)}
		</div>
	);
};

export const SubscriptionsListPage = ({
	subscriptions,
	variant = "page",
}: {
	subscriptions: ReadonlyArray<SubscriptionRow>;
	variant?: "page" | "popover";
}): VNode => {
	const popover = variant === "popover";
	// In the popover the Subscribe action swaps the popover body for the form;
	// on the page it navigates.
	const subscribeProps = popover
		? {
				"hx-get": "/ui/subscriptions/new",
				"hx-target": `#${CALENDAR_POPOVER_BODY_ID}`,
				"hx-swap": "innerHTML",
			}
		: {};
	return (
		<div class="space-y-6">
			{popover ? (
				<CalendarPopoverHeader title="Subscriptions" />
			) : (
				<PageHeader
					title="Subscriptions"
					subtitle="Read-only calendars synced from external iCalendar feeds."
					actions={
						<a href="/ui/subscriptions/new" class="btn btn-primary">
							<IconPlus class="h-4 w-4" />
							Subscribe
						</a>
					}
				/>
			)}
			{popover && (
				<a
					href="/ui/subscriptions/new"
					{...subscribeProps}
					class="btn btn-primary btn-sm"
				>
					<IconPlus class="h-4 w-4" />
					Subscribe
				</a>
			)}

			{subscriptions.length > 0 ? (
				<div class="table-wrap">
					<table class="table">
						<thead>
							<tr>
								<th>Calendar</th>
								<th>Source</th>
								<th>Last sync</th>
								<th class="w-0" />
							</tr>
						</thead>
						<tbody>
							{subscriptions.map((sub) => (
								<tr>
									<td>
										<span class="inline-flex items-center gap-2">
											<span
												class="inline-block h-3 w-3 shrink-0 rounded-full"
												style={{
													backgroundColor: sub.color ?? "rgb(var(--subtle))",
												}}
											/>
											<span class="font-medium text-fg">{sub.displayName}</span>
										</span>
									</td>
									<td class="max-w-md break-all font-mono text-xs text-muted">
										{sub.url}
									</td>
									<td class="text-sm">
										<SyncStatus sub={sub} />
									</td>
									<td class="text-right">
										<form
											method="POST"
											action={`/ui/api/subscriptions/${sub.claimId}/delete`}
											hx-post={`/ui/api/subscriptions/${sub.claimId}/delete`}
											data-confirm="Unsubscribe and delete this calendar?"
											class="inline"
										>
											<button type="submit" class="btn btn-danger btn-sm">
												Unsubscribe
											</button>
										</form>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				<div class="card card-pad text-center">
					<p class="text-sm text-muted">
						You have no subscriptions yet.{" "}
						<a href="/ui/subscriptions/new" class="link">
							Subscribe to a calendar.
						</a>
					</p>
				</div>
			)}
		</div>
	);
};

// ---------------------------------------------------------------------------

export interface HolidayPresetView {
	readonly id: string;
	readonly displayName: string;
	readonly url: string;
}

export interface SyncIntervalOption {
	readonly seconds: number;
	readonly label: string;
	readonly selected: boolean;
}

export interface SubscriptionsNewPageProps {
	readonly presets: ReadonlyArray<HolidayPresetView>;
	readonly preset?: HolidayPresetView;
	readonly intervals: ReadonlyArray<SyncIntervalOption>;
	readonly variant?: "page" | "popover";
	/** The popover this form lives in (for the header close + Cancel). */
	readonly popoverId?: string;
}

export const SubscriptionsNewPage = ({
	presets,
	preset,
	intervals,
	variant = "page",
	popoverId = CALENDAR_POPOVER_ID,
}: SubscriptionsNewPageProps): VNode => {
	const popover = variant === "popover";
	// Errors swap into the form's own [data-errors] region, whether the form is
	// rendered inline (Add-calendar → Subscribe) or lazily loaded into the
	// shared popover body (Feeds / Subscriptions); success follows the create
	// handler's HX-Redirect to /ui/calendar.
	const formProps = popover
		? { "hx-target": "find [data-errors]", "hx-swap": "innerHTML" }
		: { "hx-target": "body", "hx-swap": "outerHTML" };
	return (
		<div class={popover ? "space-y-6" : "mx-auto max-w-2xl space-y-6"}>
			{popover ? (
				<CalendarPopoverHeader
					title="Subscribe to a calendar"
					popoverId={popoverId}
				/>
			) : (
				<div>
					<CalendarCrumb title="Subscribe to a calendar" />
					<PageHeader title="Subscribe to a calendar" />
				</div>
			)}

			{!preset && (
				<div class="card card-pad">
					<h2 class="mb-3 text-sm font-semibold text-fg">Holiday presets</h2>
					<ul class="grid gap-1 sm:grid-cols-2">
						{presets.map((p) => (
							<li>
								<a
									href={`/ui/subscriptions/new?preset=${p.id}`}
									class="block rounded-md px-2 py-1.5 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg"
								>
									{p.displayName}
								</a>
							</li>
						))}
					</ul>
				</div>
			)}

			<div class="card card-pad">
				<form
					method="POST"
					action="/ui/api/subscriptions/create"
					hx-post="/ui/api/subscriptions/create"
					{...formProps}
					class="space-y-4"
				>
					{popover && (
						<>
							<input type="hidden" name="returnTo" value="/ui/calendar" />
							<div data-errors />
						</>
					)}
					<label class="form-group block">
						<span class="form-label">
							iCalendar URL <span class="text-danger">*</span>
						</span>
						<input
							type="url"
							name="url"
							required
							value={preset ? preset.url : ""}
							placeholder="https://example.com/calendar.ics"
							class="form-input"
						/>
					</label>
					<label class="form-group block">
						<span class="form-label">
							Slug <span class="text-danger">*</span>
						</span>
						<input
							type="text"
							name="slug"
							required
							pattern="[a-z0-9-]+"
							value={preset ? `holidays-${preset.id}` : ""}
							placeholder="e.g. holidays-us"
							class="form-input"
						/>
						<span class="form-hint">
							URL segment for this subscription's collection.
						</span>
					</label>
					<label class="form-group block">
						<span class="form-label">Display name override</span>
						<input
							type="text"
							name="displayName"
							value={preset ? preset.displayName : ""}
							class="form-input"
						/>
						<span class="form-hint">
							Leave blank to use the feed's own name.
						</span>
					</label>
					<label class="form-group block">
						<span class="form-label">Color override</span>
						<input
							type="color"
							name="color"
							class="h-10 w-20 rounded-md border border-line-strong"
						/>
					</label>
					<label class="form-group block">
						<span class="form-label">Sync frequency</span>
						<select name="syncIntervalS" class="form-select">
							{intervals.map((o) =>
								o.selected ? (
									<option value={o.seconds} selected>
										{o.label}
									</option>
								) : (
									<option value={o.seconds}>{o.label}</option>
								),
							)}
						</select>
					</label>
					<div class="flex gap-3 pt-1">
						<button type="submit" class="btn btn-primary">
							Subscribe
						</button>
						{popover ? (
							<button
								type="button"
								commandfor={popoverId}
								command="request-close"
								class="btn btn-secondary"
							>
								Cancel
							</button>
						) : (
							<a href="/ui/subscriptions" class="btn btn-secondary">
								Cancel
							</a>
						)}
					</div>
				</form>
			</div>
		</div>
	);
};
