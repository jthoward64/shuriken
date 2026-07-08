import type { VNode } from "preact";

// ---------------------------------------------------------------------------
// Contact edit dialog (<dialog> + Invoker Commands API), mirroring calendar's
// event-popovers.tsx. The hover card's Edit button is a real link (no-JS
// follows it to the full edit page); with JS, contacts.js loads the pre-filled
// form fragment (ContactFormPage with variant="popover") into
// `#edit-contact-popover-body` and shows this dialog instead.
// ---------------------------------------------------------------------------

export const EDIT_CONTACT_POPOVER_ID = "edit-contact-popover";
export const EDIT_CONTACT_POPOVER_BODY_ID = "edit-contact-popover-body";

export const EditContactPopoverContainer = (): VNode => (
	<dialog
		id={EDIT_CONTACT_POPOVER_ID}
		aria-labelledby={`${EDIT_CONTACT_POPOVER_ID}-title`}
		class="modal-popover"
	>
		<div
			id={EDIT_CONTACT_POPOVER_BODY_ID}
			class="modal-popover-panel card card-pad"
		/>
	</dialog>
);
