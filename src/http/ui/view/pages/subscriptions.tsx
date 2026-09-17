import type { VNode } from "preact";
import { Button, LinkButton } from "../components/button.tsx";
import {
	Badge,
	Card,
	type Column,
	EmptyState,
	Table,
} from "../components/display.tsx";
import { Field, TextInput } from "../components/form/form.tsx";
import { Select } from "../components/form/select.tsx";
import { IconPlus } from "../components/icons.tsx";
import { Breadcrumb, PageHeader } from "../components/page-header.tsx";

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

// Subscriptions hang off the calendar section, so the trail starts there
const CalendarCrumb = ({ title }: { title: string }) => (
	<Breadcrumb
		items={[{ label: "Calendar", href: "/ui/calendar" }, { label: title }]}
	/>
);

const SyncStatus = ({ sub }: { sub: SubscriptionRow }) => {
	if (sub.lastSyncAt === null) {
		return <span class="text-subtle">Never synced</span>;
	}
	return (
		<div>
			<Badge tone={sub.lastSyncStatus === "failure" ? "danger" : "success"}>
				{sub.lastSyncStatus}
			</Badge>
			<span class="ml-2 text-xs text-subtle">{sub.lastSyncAt}</span>
			{sub.lastSyncError && (
				<div class="mt-1 text-xs text-danger">{sub.lastSyncError}</div>
			)}
		</div>
	);
};

const SUBSCRIPTION_COLUMNS: ReadonlyArray<Column<SubscriptionRow>> = [
	{
		header: "Calendar",
		cell: (sub) => (
			<span class="inline-flex items-center gap-2">
				<span
					class="inline-block h-3 w-3 shrink-0 rounded-full"
					style={{ backgroundColor: sub.color ?? "rgb(var(--subtle))" }}
				/>
				<span class="font-medium text-fg">{sub.displayName}</span>
			</span>
		),
	},
	{
		header: "Source",
		cell: (sub) => (
			<span class="block max-w-md break-all font-mono text-xs text-muted">
				{sub.url}
			</span>
		),
	},
	{ header: "Last sync", cell: (sub) => <SyncStatus sub={sub} /> },
	{
		header: "",
		align: "right",
		shrink: true,
		cell: (sub) => (
			<form
				method="POST"
				action={`/ui/api/subscriptions/${sub.claimId}/delete`}
				hx-post={`/ui/api/subscriptions/${sub.claimId}/delete`}
				data-confirm="Unsubscribe and delete this calendar?"
				class="inline"
			>
				<Button type="submit" variant="danger" size="sm">
					Unsubscribe
				</Button>
			</form>
		),
	},
];

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
						<LinkButton href="/ui/subscriptions/new" variant="primary">
							<IconPlus class="h-4 w-4" />
							Subscribe
						</LinkButton>
					}
				/>
			)}
			{popover && (
				<LinkButton
					href="/ui/subscriptions/new"
					{...subscribeProps}
					variant="primary"
					size="sm"
				>
					<IconPlus class="h-4 w-4" />
					Subscribe
				</LinkButton>
			)}

			<Table
				columns={SUBSCRIPTION_COLUMNS}
				rows={subscriptions}
				getKey={(sub) => sub.claimId}
				empty={
					<EmptyState
						title="You have no subscriptions yet."
						action={
							<LinkButton
								href="/ui/subscriptions/new"
								variant="primary"
								size="sm"
							>
								<IconPlus class="h-4 w-4" />
								Subscribe
							</LinkButton>
						}
					/>
				}
			/>
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
	// This form can share the DOM with the inline Create-calendar form, so in the
	// popover its field ids are scoped by the popover id to keep them unique.
	const fieldId = (name: string): string =>
		popover ? `${popoverId}-sub-${name}` : name;
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
				<Card>
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
				</Card>
			)}

			<Card>
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
					<Field for={fieldId("url")} label="iCalendar URL" required>
						<TextInput
							type="url"
							id={fieldId("url")}
							name="url"
							required
							value={preset ? preset.url : ""}
							placeholder="https://example.com/calendar.ics"
						/>
					</Field>
					<Field
						for={fieldId("slug")}
						label="Slug"
						required
						hint="URL segment for this subscription's collection."
					>
						<TextInput
							id={fieldId("slug")}
							name="slug"
							required
							pattern="[a-z0-9-]+"
							value={preset ? `holidays-${preset.id}` : ""}
							placeholder="e.g. holidays-us"
						/>
					</Field>
					<Field
						for={fieldId("displayName")}
						label="Display name override"
						hint="Leave blank to use the feed's own name."
					>
						<TextInput
							id={fieldId("displayName")}
							name="displayName"
							value={preset ? preset.displayName : ""}
						/>
					</Field>
					<Field for={fieldId("color")} label="Color override">
						<input
							type="color"
							id={fieldId("color")}
							name="color"
							class="h-10 w-20 rounded-md border border-line-strong"
						/>
					</Field>
					<Field for={fieldId("syncIntervalS")} label="Sync frequency">
						<Select
							id={fieldId("syncIntervalS")}
							name="syncIntervalS"
							options={intervals.map((o) => ({
								value: String(o.seconds),
								label: o.label,
							}))}
							value={String(intervals.find((o) => o.selected)?.seconds ?? "")}
						/>
					</Field>
					<div class="flex gap-3 pt-1">
						<Button type="submit" variant="primary">
							Subscribe
						</Button>
						{popover ? (
							<Button commandfor={popoverId} command="request-close">
								Cancel
							</Button>
						) : (
							<LinkButton href="/ui/subscriptions">Cancel</LinkButton>
						)}
					</div>
				</form>
			</Card>
		</div>
	);
};
