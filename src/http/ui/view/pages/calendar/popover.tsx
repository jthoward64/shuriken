import type { VNode } from "preact";
import { IconClose } from "../../icons.tsx";

// ---------------------------------------------------------------------------
// Shared calendar modal popover — for the Subscriptions / Feeds management
// dialogs (Add-calendar's Create and Subscribe dialogs have their own inline
// popovers, see below).
//
// One container (`CalendarPopoverContainer`) is rendered at the root of the
// calendar page. Sidebar triggers load their fragment into
// `#calendar-popover-body` via HTMX, and calendar.client.ts reveals the popover
// once the body is swapped. No-JS users follow the trigger's `href` to the full
// page instead. Each loaded fragment starts with a `CalendarPopoverHeader`.
//
// (Distinct from the event popovers in event-popovers.tsx, which are their own
// New/Edit dialogs.)
// ---------------------------------------------------------------------------

export const CALENDAR_POPOVER_ID = "calendar-popover";
export const CALENDAR_POPOVER_BODY_ID = "calendar-popover-body";
// The Create-calendar and Subscribe dialogs (from the "Add calendar" menu)
// have their forms rendered inline (their own dialog), so they open natively
// via commandfor/command="show-modal" with no JS.
export const CREATE_CALENDAR_POPOVER_ID = "create-calendar-popover";
export const SUBSCRIBE_CALENDAR_POPOVER_ID = "subscribe-calendar-popover";

export const CalendarPopoverContainer = (): VNode => (
	<dialog
		id={CALENDAR_POPOVER_ID}
		aria-labelledby={`${CALENDAR_POPOVER_ID}-title`}
		class="modal-popover"
	>
		<div
			id={CALENDAR_POPOVER_BODY_ID}
			class="modal-popover-panel card card-pad"
		/>
	</dialog>
);

export const CalendarPopoverHeader = ({
	title,
	popoverId = CALENDAR_POPOVER_ID,
}: {
	title: string;
	popoverId?: string;
}): VNode => (
	<div class="mb-4 flex items-center justify-between gap-3">
		<h2 id={`${popoverId}-title`} class="card-title">
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
