import type { ComponentChildren, VNode } from "preact";

// ---------------------------------------------------------------------------
// Two-column sidebar shell used by the calendar and contacts pages.
//
// A left `<aside>` (a card) sits beside the main content. Under the layout's
// `fill` mode the whole shell is bounded to the viewport on lg+, so the aside
// fills the available height — split into a scrollable `top` region (primary
// action + list) and a `bottom` region pinned to the base (import/export/tools)
// — and the main column fills the height too (its own children flex/scroll). On
// small screens the columns stack and everything flows at natural height.
// ---------------------------------------------------------------------------

export const SidebarShell = ({
	label,
	top,
	bottom,
	children,
}: {
	/** Accessible label for the sidebar landmark (e.g. "Calendars"). */
	readonly label: string;
	/** Scrollable upper region — primary action + the list. */
	readonly top: ComponentChildren;
	/** Pinned lower region — import/export/tools. */
	readonly bottom: ComponentChildren;
	/** Main content beside the sidebar. */
	readonly children: ComponentChildren;
}): VNode => (
	<div class="flex flex-col gap-6 lg:h-full lg:flex-row lg:items-stretch">
		<aside
			aria-label={label}
			class="card flex w-full flex-col lg:h-full lg:w-72 lg:shrink-0"
		>
			<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
				{top}
			</div>
			<div class="shrink-0 space-y-2 border-t border-line p-3">{bottom}</div>
		</aside>
		<div class="flex min-w-0 flex-1 flex-col gap-4 lg:h-full lg:min-h-0">
			{children}
		</div>
	</div>
);
