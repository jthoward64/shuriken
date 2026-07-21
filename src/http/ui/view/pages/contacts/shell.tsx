import type { ComponentChildren, VNode } from "preact";
import { IconClose, IconMenu } from "../../icons.tsx";

// ---------------------------------------------------------------------------
// Contacts-specific layout shell (the calendar's SidebarShell only knows two
// columns; this one adds the mobile drawer + the list/preview split).
//
// The address-book sidebar is a popover (`popover="auto"`): a left-anchored
// drawer up to xl (toggled natively via popovertarget — no JS — with native
// light-dismiss on a backdrop click / Escape) and a persistent inline column at
// xl+ (CSS force-shows the closed popover as `display:block; position:static`).
// It collapses at xl rather than lg so the address-book list doesn't cramp
// beside the list/preview split on mid-size screens. Rendered once.
//
// The main column holds whatever the caller passes (notices, the search
// header, the list/preview split — the split itself stays two-up from lg+).
// ---------------------------------------------------------------------------

export const CONTACTS_DRAWER_ID = "contacts-drawer";

export const ContactsShell = ({
	label,
	drawerTop,
	drawerBottom,
	children,
}: {
	/** Accessible label for the drawer landmark (e.g. "Address books"). */
	readonly label: string;
	/** Scrollable upper region — primary action + address-book list. */
	readonly drawerTop: ComponentChildren;
	/** Pinned lower region — import / export / tools. */
	readonly drawerBottom: ComponentChildren;
	/** Main content beside the drawer. */
	readonly children: ComponentChildren;
}): VNode => (
	<div class="flex flex-col lg:h-full lg:flex-row lg:items-stretch">
		<dialog
			id={CONTACTS_DRAWER_ID}
			popover="auto"
			aria-label={label}
			class="contacts-drawer"
		>
			<div class="contacts-drawer-panel flex flex-col">
				<div class="flex items-center justify-between p-3 pb-0 xl:hidden">
					<h2 class="card-title">{label}</h2>
					<button
						type="button"
						popovertarget={CONTACTS_DRAWER_ID}
						popovertargetaction="hide"
						aria-label="Close"
						class="btn btn-ghost btn-sm"
					>
						<IconClose class="h-4 w-4" />
					</button>
				</div>
				<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
					{drawerTop}
				</div>
				<div class="shrink-0 space-y-2 border-t border-line p-3">
					{drawerBottom}
				</div>
			</div>
		</dialog>
		<div class="flex min-w-0 flex-1 flex-col lg:h-full lg:min-h-0">
			{children}
		</div>
	</div>
);

// The mobile trigger that toggles the drawer (hidden on desktop, where the
// drawer is always visible). Native popovertarget — works with no JS.
export const ContactsDrawerToggle = (): VNode => (
	<button
		type="button"
		popovertarget={CONTACTS_DRAWER_ID}
		class="btn btn-secondary btn-sm shrink-0 xl:hidden"
	>
		<IconMenu class="h-4 w-4" />
		Address books
	</button>
);
