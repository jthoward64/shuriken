import type { VNode } from "preact";
import {
	type EventFormData,
	emptyEventForm,
} from "#src/services/cal-edit/types.ts";
import { IconClose } from "../../icons.tsx";
import { EventFormBody } from "./event-form.tsx";

// ---------------------------------------------------------------------------
// Calendar event dialogs (<dialog> + Invoker Commands API).
//
// Progressive enhancement: the New-event control is a
// `<button commandfor command="show-modal">` so the blank form opens with no
// JavaScript; FullCalendar instead calls `showModal()` after seeding the date
// fields. Editing loads the pre-filled form fragment (`EventEditPopoverForm`)
// into `#edit-event-popover-body` via HTMX and shows the dialog — the no-JS
// path stays the full edit page.
//
// Submits carry both `method`/`action` (no-JS full POST → redirect → reload)
// and `hx-post` (JS → 204 + HX-Trigger `shuriken:calendar-refresh`, which the
// calendar script uses to close the dialog and refetch without a reload).
// ---------------------------------------------------------------------------

export const NEW_EVENT_POPOVER_ID = "new-event-popover";
export const EDIT_EVENT_POPOVER_ID = "edit-event-popover";
export const EDIT_EVENT_POPOVER_BODY_ID = "edit-event-popover-body";

// Shared header: a title plus a native close button (command="request-close"
// needs no JS, and still gives an unsaved-edits confirm a chance to veto it via
// the dialog's cancelable `cancel` event). `type="button"` keeps it from
// submitting a surrounding form.
const PopoverHeader = ({
	titleId,
	title,
	popoverId,
}: {
	titleId: string;
	title: string;
	popoverId: string;
}): VNode => (
	<div class="flex items-center justify-between gap-3">
		<h2 id={titleId} class="card-title">
			{title}
		</h2>
		<button
			type="button"
			commandfor={popoverId}
			command="request-close"
			aria-label="Close"
			class="btn btn-ghost btn-sm"
		>
			<IconClose class="h-4 w-4" />
		</button>
	</div>
);

// New-event popover: rendered once on the calendar page for the selected
// calendar. Blank form; the title field autofocuses when the popover shows.
export const NewEventPopover = ({
	collectionId,
	form = emptyEventForm,
}: {
	collectionId: string;
	form?: EventFormData;
}): VNode => {
	const action = `/ui/api/calendar/${collectionId}/events/create`;
	return (
		<dialog
			id={NEW_EVENT_POPOVER_ID}
			aria-labelledby={`${NEW_EVENT_POPOVER_ID}-title`}
			class="event-popover"
		>
			<div class="event-popover-panel card card-pad">
				<PopoverHeader
					titleId={`${NEW_EVENT_POPOVER_ID}-title`}
					title="New event"
					popoverId={NEW_EVENT_POPOVER_ID}
				/>
				<form
					method="POST"
					action={action}
					hx-post={action}
					hx-swap="none"
					class="mt-4"
				>
					<EventFormBody form={form} idPrefix="new-" autofocus />
					<div class="flex flex-wrap gap-3 pt-5">
						<button type="submit" class="btn btn-primary">
							Create event
						</button>
						<button
							type="button"
							commandfor={NEW_EVENT_POPOVER_ID}
							command="request-close"
							class="btn btn-secondary"
						>
							Cancel
						</button>
					</div>
				</form>
			</div>
		</dialog>
	);
};

// Empty edit dialog container, rendered once on the calendar page. HTMX swaps
// the pre-filled `EventEditPopoverForm` fragment into the body on demand.
export const EditEventPopoverContainer = (): VNode => (
	<dialog
		id={EDIT_EVENT_POPOVER_ID}
		aria-labelledby={`${EDIT_EVENT_POPOVER_ID}-title`}
		class="event-popover"
	>
		<div
			id={EDIT_EVENT_POPOVER_BODY_ID}
			class="event-popover-panel card card-pad"
		/>
	</dialog>
);

// Fragment content for the edit popover body — the edit handler renders this
// (not the full page) when it sees the `HX-Request` header.
export const EventEditPopoverForm = ({
	title,
	form,
	action,
	deleteAction,
}: {
	title: string;
	form: EventFormData;
	action: string;
	deleteAction: string;
}): VNode => (
	<>
		<PopoverHeader
			titleId={`${EDIT_EVENT_POPOVER_ID}-title`}
			title={title}
			popoverId={EDIT_EVENT_POPOVER_ID}
		/>
		<form
			method="POST"
			action={action}
			hx-post={action}
			hx-swap="none"
			class="mt-4"
		>
			<EventFormBody form={form} idPrefix="edit-" autofocus />
			<div class="flex flex-wrap items-center gap-3 pt-5">
				<button type="submit" class="btn btn-primary">
					Save changes
				</button>
				<button
					type="button"
					commandfor={EDIT_EVENT_POPOVER_ID}
					command="request-close"
					class="btn btn-secondary"
				>
					Cancel
				</button>
				<button
					type="submit"
					form={`${EDIT_EVENT_POPOVER_ID}-delete`}
					class="btn btn-danger ml-auto"
				>
					Delete
				</button>
			</div>
		</form>
		{/* Separate form so Delete never carries the edit fields. Associated with
		    the Delete button above via the `form` attribute (they cannot nest). */}
		<form
			id={`${EDIT_EVENT_POPOVER_ID}-delete`}
			method="POST"
			action={deleteAction}
			hx-post={deleteAction}
			hx-swap="none"
			data-confirm="Delete this event?"
			class="hidden"
		/>
	</>
);
