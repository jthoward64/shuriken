import type { VNode } from "preact";
import { IconClose } from "../../icons.tsx";

// ---------------------------------------------------------------------------
// Shared contacts modal popover.
//
// One container (`ContactsPopoverContainer`) is rendered at the root of the
// contacts list page. The sidebar triggers (New contact / Find duplicates /
// Clean up) load their fragment into `#contacts-popover-body` via HTMX, and
// static/contacts.js reveals the popover once the body is swapped (and hides it
// on `contacts:changed`). No-JS users follow the trigger's `href` to the full
// page instead.
//
// Each loaded fragment starts with a `ContactsPopoverHeader` (title + native
// close button) since the body is a `card card-pad` panel.
// ---------------------------------------------------------------------------

export const CONTACTS_POPOVER_ID = "contacts-popover";
export const CONTACTS_POPOVER_BODY_ID = "contacts-popover-body";
// The New-contact dialog has its form rendered inline (its own dialog), so it
// opens natively via commandfor/command="show-modal" with no JS.
export const NEW_CONTACT_POPOVER_ID = "new-contact-popover";

export const ContactsPopoverContainer = (): VNode => (
	<dialog
		id={CONTACTS_POPOVER_ID}
		aria-labelledby={`${CONTACTS_POPOVER_ID}-title`}
		class="modal-popover"
	>
		<div
			id={CONTACTS_POPOVER_BODY_ID}
			class="modal-popover-panel card card-pad"
		/>
	</dialog>
);

export const ContactsPopoverHeader = ({
	title,
	popoverId = CONTACTS_POPOVER_ID,
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
