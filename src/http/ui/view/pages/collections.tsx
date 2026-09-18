import type { VNode } from "preact";
import type { SharePanelData } from "#src/http/ui/helpers/share-panel.ts";
import { Button, LinkButton } from "../components/button.tsx";
import { Card } from "../components/display.tsx";
import { Field, Textarea, TextInput } from "../components/form/form.tsx";
import { Select } from "../components/form/select.tsx";
import { Breadcrumb, PageHeader } from "../components/page-header.tsx";

import {
	CALENDAR_POPOVER_BODY_ID,
	CALENDAR_POPOVER_ID,
	CalendarPopoverHeader,
} from "./calendar/popover.tsx";
import {
	type CalendarFeedMembership,
	type CalendarFeedOption,
	CalendarFeedsSection,
} from "./feeds.tsx";
import { SharePanel } from "./share-panel.tsx";

// ---------------------------------------------------------------------------
// Collection pages: create (owned by a user or group) and edit. The edit page
// hosts the calendar-only timezone/colour fields and the ACL panel.
// ---------------------------------------------------------------------------

export type CollectionOwnerType = "user" | "group";

const ownerCrumb = (
	ownerType: CollectionOwnerType,
	ownerDisplayName: string,
	ownerHref: string,
): ReadonlyArray<{ label: string; href?: string }> =>
	ownerType === "user"
		? [
				{ label: "Users", href: "/ui/users" },
				{ label: ownerDisplayName, href: ownerHref },
			]
		: [
				{ label: "Groups", href: "/ui/groups" },
				{ label: ownerDisplayName, href: ownerHref },
			];

const COLLECTION_TYPE_OPTIONS = [
	{ value: "", label: "Select a type…" },
	{ value: "calendar", label: "Calendar" },
	{ value: "addressbook", label: "Address Book" },
];

// --- New -------------------------------------------------------------------

export interface CollectionNewPageProps {
	readonly ownerType: CollectionOwnerType;
	readonly ownerDisplayName: string;
	readonly createUrl: string;
	readonly backUrl: string;
	/** "popover" renders the inline Add-calendar dialog (header instead of
	 * breadcrumb, type pre-set to calendar, submits back to the calendar). */
	readonly variant?: "page" | "popover";
	/** The popover this form lives in (for the header close + Cancel). */
	readonly popoverId?: string;
}

export const CollectionNewPage = ({
	ownerType,
	ownerDisplayName,
	createUrl,
	backUrl,
	variant = "page",
	popoverId = CALENDAR_POPOVER_ID,
}: CollectionNewPageProps): VNode => {
	const popover = variant === "popover";
	// The inline dialog is always in the DOM alongside the lazily-loaded
	// Subscribe form, so its field ids are scoped by the popover id to keep them
	// unique. Errors swap into the form's own [data-errors] region; success
	// redirects.
	const fieldId = (name: string): string =>
		popover ? `${popoverId}-${name}` : name;
	const formProps = popover
		? { "hx-target": "find [data-errors]", "hx-swap": "innerHTML" }
		: { "hx-target": "body", "hx-swap": "outerHTML" };
	return (
		<div class={popover ? "space-y-6" : "mx-auto max-w-2xl space-y-6"}>
			{popover ? (
				<CalendarPopoverHeader title="Create calendar" popoverId={popoverId} />
			) : (
				<div>
					<Breadcrumb
						items={[
							...ownerCrumb(ownerType, ownerDisplayName, backUrl),
							{ label: "New collection" },
						]}
					/>
					<PageHeader title="New collection" />
				</div>
			)}

			<Card>
				<form
					method="POST"
					action={createUrl}
					hx-post={createUrl}
					{...formProps}
					class="space-y-4"
				>
					{popover && (
						<>
							<input type="hidden" name="returnTo" value="/ui/calendar" />
							<div data-errors />
						</>
					)}
					<Field for={fieldId("collectionType")} label="Type" required>
						<Select
							id={fieldId("collectionType")}
							name="collectionType"
							required
							options={COLLECTION_TYPE_OPTIONS}
							value={popover ? "calendar" : ""}
						/>
					</Field>
					<Field
						for={fieldId("slug")}
						label="Slug"
						required
						hint="Lowercase letters, digits, and hyphens only. Used in DAV URLs."
					>
						<TextInput
							id={fieldId("slug")}
							name="slug"
							required
							pattern="[a-z0-9-]+"
							placeholder="e.g. personal-calendar"
						/>
					</Field>
					<Field for={fieldId("displayName")} label="Display name">
						<TextInput id={fieldId("displayName")} name="displayName" />
					</Field>
					<div class="flex gap-3 pt-2">
						<Button type="submit" variant="primary">
							Create collection
						</Button>
						{popover ? (
							<Button commandfor={popoverId} command="request-close">
								Cancel
							</Button>
						) : (
							<LinkButton href={backUrl}>Cancel</LinkButton>
						)}
					</div>
				</form>
			</Card>
		</div>
	);
};

// --- Edit ------------------------------------------------------------------

export interface CollectionEditPageProps {
	readonly id: string;
	readonly title: string;
	readonly slug: string;
	readonly displayName: string;
	readonly description: string;
	readonly collectionType: string;
	readonly ownerType: CollectionOwnerType;
	readonly ownerDisplayName: string;
	readonly ownerPrincipalId: string;
	readonly isCalendar: boolean;
	readonly timezoneTzid: string;
	/** CSS `#RRGGBB` colour, calendars only. */
	readonly calendarColor: string;
	readonly canDelete: boolean;
	readonly sharePanel: SharePanelData | undefined;
	/** "popover" renders the compact edit dialog (header instead of breadcrumb,
	 * submits back to the calendar) used by the calendar sidebar's per-calendar
	 * Edit trigger. The Share panel is shown in both variants. */
	readonly variant?: "page" | "popover";
	readonly popoverId?: string;
	/** Feeds this calendar belongs to / can be added to — popover + calendars
	 * only. Undefined suppresses the section entirely. */
	readonly feeds?: {
		readonly member: ReadonlyArray<CalendarFeedMembership>;
		readonly addable: ReadonlyArray<CalendarFeedOption>;
	};
	/** True for the server-managed "Birthdays" calendar — shows a manual
	 * force-refresh action instead of the normal delete/edit affordances. */
	readonly isBirthdaysCollection?: boolean;
}

// The timezone and colour fields, which only a calendar collection carries
const CalendarOnlyFields = ({
	timezoneTzid,
	calendarColor,
}: {
	timezoneTzid: string;
	calendarColor: string;
}): VNode => (
	<>
		<Field for="timezoneTzid" label="Timezone">
			<TextInput
				id="timezoneTzid"
				name="timezoneTzid"
				value={timezoneTzid}
				placeholder="e.g. America/New_York"
			/>
		</Field>
		<Field for="color" label="Color">
			<div class="flex items-center gap-3">
				<input
					type="color"
					id="color"
					name="color"
					value={calendarColor}
					class="h-9 w-14 cursor-pointer rounded border border-line bg-surface-2 p-1"
				/>
				<span class="text-muted text-xs">
					Shown as the event colour in the calendar and in CalDAV clients.
				</span>
			</div>
		</Field>
	</>
);

// Breadcrumb + title for the full-page variant (the popover has its own header)
const CollectionPageHeader = ({
	title,
	ownerType,
	ownerDisplayName,
	ownerHref,
	actions,
}: {
	title: string;
	ownerType: "user" | "group";
	ownerDisplayName: string;
	ownerHref: string;
	actions: VNode | null;
}): VNode => (
	<div>
		<Breadcrumb
			items={[
				...ownerCrumb(ownerType, ownerDisplayName, ownerHref),
				{ label: title },
			]}
		/>
		<PageHeader
			title={title}
			actions={
				actions === null ? undefined : (
					<div class="flex items-center gap-2">{actions}</div>
				)
			}
		/>
	</div>
);

export const CollectionEditPage = (props: CollectionEditPageProps): VNode => {
	const popover = (props.variant ?? "page") === "popover";
	const popoverId = props.popoverId ?? CALENDAR_POPOVER_ID;
	const ownerHref = `/ui/${props.ownerType === "user" ? "users" : "groups"}/${props.ownerPrincipalId}`;
	const base = `/ui/api/collections/${props.id}`;
	// In the popover, form responses swap errors back into the popover body;
	// success follows the update/delete handler's HX-Redirect to /ui/calendar.
	const formProps = popover
		? { "hx-target": `#${CALENDAR_POPOVER_BODY_ID}`, "hx-swap": "innerHTML" }
		: { "hx-target": "body", "hx-swap": "outerHTML" };
	const regenerateBirthdaysButton = props.isBirthdaysCollection && (
		<form
			method="POST"
			action={`${base}/regenerate-birthdays`}
			hx-post={`${base}/regenerate-birthdays`}
			{...formProps}
			class="inline"
		>
			<Button type="submit" size="sm">
				Refresh now
			</Button>
		</form>
	);
	const deleteButton = props.canDelete && (
		<form
			method="POST"
			action={`${base}/delete`}
			hx-post={`${base}/delete`}
			{...formProps}
			hx-confirm="Delete this collection? This cannot be undone."
			data-confirm="Delete this collection? This cannot be undone."
			class="inline"
		>
			{popover && <input type="hidden" name="returnTo" value="/ui/calendar" />}
			<Button type="submit" variant="danger" size="sm">
				Delete
			</Button>
		</form>
	);
	const actions =
		regenerateBirthdaysButton || deleteButton ? (
			<>
				{regenerateBirthdaysButton}
				{deleteButton}
			</>
		) : null;
	return (
		<div class={popover ? "space-y-6" : "mx-auto max-w-2xl space-y-6"}>
			{popover ? (
				<CalendarPopoverHeader title={props.title} popoverId={popoverId} />
			) : (
				<CollectionPageHeader
					title={props.title}
					ownerType={props.ownerType}
					ownerDisplayName={props.ownerDisplayName}
					ownerHref={ownerHref}
					actions={actions}
				/>
			)}

			<Card title={popover ? undefined : "Details"}>
				<form
					method="POST"
					action={`${base}/update`}
					hx-post={`${base}/update`}
					{...formProps}
					class="space-y-4"
				>
					{popover && (
						<>
							<input type="hidden" name="returnTo" value="/ui/calendar" />
							<div data-errors />
						</>
					)}
					<Field for="displayName" label="Display name">
						<TextInput
							id="displayName"
							name="displayName"
							value={props.displayName}
						/>
					</Field>
					<Field for="description" label="Description">
						<Textarea
							id="description"
							name="description"
							value={props.description}
						/>
					</Field>
					{props.isCalendar ? (
						<CalendarOnlyFields
							timezoneTzid={props.timezoneTzid}
							calendarColor={props.calendarColor}
						/>
					) : null}
					<p class="text-muted text-sm">
						<span class="font-medium text-fg">Slug:</span>{" "}
						<span class="font-mono">{props.slug}</span>
						<span class="ml-2 text-subtle text-xs">
							(changing this breaks DAV client sync)
						</span>
					</p>
					<p class="text-muted text-sm">
						<span class="font-medium text-fg">Type:</span>{" "}
						{props.collectionType}
					</p>
					<div class="flex items-center gap-3 pt-2">
						<Button type="submit" variant="primary">
							Save changes
						</Button>
						{popover && (
							<Button commandfor={popoverId} command="request-close">
								Cancel
							</Button>
						)}
					</div>
				</form>
				{popover && actions !== null && (
					<div class="mt-4 flex items-center gap-3 border-line border-t pt-4">
						{actions}
					</div>
				)}
			</Card>

			{popover && props.isCalendar && props.feeds !== undefined ? (
				<Card title="Feeds">
					<CalendarFeedsSection
						calendarId={props.id}
						memberFeeds={props.feeds.member}
						addableFeeds={props.feeds.addable}
						addUrl={`${base}/feeds/add`}
					/>
				</Card>
			) : null}

			<SharePanel data={props.sharePanel} />
		</div>
	);
};
