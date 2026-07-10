import type { VNode } from "preact";
import type { SharePanelData } from "#src/http/ui/helpers/share-panel.ts";
import { Breadcrumb, Card, PageHeader } from "../ui.tsx";
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
	// The inline dialog is always in the DOM, so its fields use wrapping labels
	// (no ids) to avoid clashing with the lazily-loaded Subscribe form. Errors
	// swap into the form's own [data-errors] region; success redirects.
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
					<label class="form-group block">
						<span class="form-label">
							Type <span class="text-danger">*</span>
						</span>
						<select name="collectionType" required class="form-select">
							<option value="">Select a type…</option>
							<option value="calendar" selected={popover}>
								Calendar
							</option>
							<option value="addressbook">Address Book</option>
						</select>
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
							placeholder="e.g. personal-calendar"
							class="form-input"
						/>
						<span class="form-hint">
							Lowercase letters, digits, and hyphens only. Used in DAV URLs.
						</span>
					</label>
					<label class="form-group block">
						<span class="form-label">Display name</span>
						<input type="text" name="displayName" class="form-input" />
					</label>
					<div class="flex gap-3 pt-2">
						<button type="submit" class="btn btn-primary">
							Create collection
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
							<a href={backUrl} class="btn btn-secondary">
								Cancel
							</a>
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
			<button type="submit" class="btn btn-secondary btn-sm">
				Refresh now
			</button>
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
			<button type="submit" class="btn btn-danger btn-sm">
				Delete
			</button>
		</form>
	);
	return (
		<div class={popover ? "space-y-6" : "mx-auto max-w-2xl space-y-6"}>
			{popover ? (
				<CalendarPopoverHeader title={props.title} popoverId={popoverId} />
			) : (
				<div>
					<Breadcrumb
						items={[
							...ownerCrumb(props.ownerType, props.ownerDisplayName, ownerHref),
							{ label: props.title },
						]}
					/>
					<PageHeader
						title={props.title}
						actions={
							(regenerateBirthdaysButton || deleteButton) && (
								<div class="flex items-center gap-2">
									{regenerateBirthdaysButton}
									{deleteButton}
								</div>
							)
						}
					/>
				</div>
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
					<div class="form-group">
						<label for="displayName" class="form-label">
							Display name
						</label>
						<input
							type="text"
							id="displayName"
							name="displayName"
							value={props.displayName}
							class="form-input"
						/>
					</div>
					<div class="form-group">
						<label for="description" class="form-label">
							Description
						</label>
						<textarea
							id="description"
							name="description"
							rows={3}
							class="form-textarea"
							value={props.description}
						/>
					</div>
					{props.isCalendar && (
						<>
							<div class="form-group">
								<label for="timezoneTzid" class="form-label">
									Timezone
								</label>
								<input
									type="text"
									id="timezoneTzid"
									name="timezoneTzid"
									value={props.timezoneTzid}
									placeholder="e.g. America/New_York"
									class="form-input"
								/>
							</div>
							<div class="form-group">
								<label for="color" class="form-label">
									Color
								</label>
								<div class="flex items-center gap-3">
									<input
										type="color"
										id="color"
										name="color"
										value={props.calendarColor}
										class="h-9 w-14 cursor-pointer rounded border border-line bg-surface-2 p-1"
									/>
									<span class="text-xs text-muted">
										Shown as the event colour in the calendar and in CalDAV
										clients.
									</span>
								</div>
							</div>
						</>
					)}
					<p class="text-sm text-muted">
						<span class="font-medium text-fg">Slug:</span>{" "}
						<span class="font-mono">{props.slug}</span>
						<span class="ml-2 text-xs text-subtle">
							(changing this breaks DAV client sync)
						</span>
					</p>
					<p class="text-sm text-muted">
						<span class="font-medium text-fg">Type:</span>{" "}
						{props.collectionType}
					</p>
					<div class="flex items-center gap-3 pt-2">
						<button type="submit" class="btn btn-primary">
							Save changes
						</button>
						{popover && (
							<button
								type="button"
								commandfor={popoverId}
								command="request-close"
								class="btn btn-secondary"
							>
								Cancel
							</button>
						)}
					</div>
				</form>
				{popover && (regenerateBirthdaysButton || deleteButton) && (
					<div class="mt-4 flex items-center gap-3 border-t border-line pt-4">
						{regenerateBirthdaysButton}
						{deleteButton}
					</div>
				)}
			</Card>

			{popover && props.isCalendar && props.feeds && (
				<Card title="Feeds">
					<CalendarFeedsSection
						calendarId={props.id}
						memberFeeds={props.feeds.member}
						addableFeeds={props.feeds.addable}
						addUrl={`${base}/feeds/add`}
					/>
				</Card>
			)}

			<SharePanel data={props.sharePanel} />
		</div>
	);
};
