import type { ComponentChildren, VNode } from "preact";
import { cx } from "../cx.ts";

// ---------------------------------------------------------------------------
// Two-column sidebar shell used by the calendar and tasks pages (edge-to-edge
// under the layout's wide mode).
//
// A left `<aside>` (a flush, square-cornered panel) sits beside the main
// content. Under `fill` mode the whole shell is bounded to the viewport on lg+,
// so the aside fills the available height — split into a scrollable `top` region
// (primary action + list) and a `bottom` region pinned to the base — and the
// main column fills the height too. On small screens the columns stack.
//
// `gap` keeps a gutter between the aside and the content (tasks); pass false to
// butt them together (calendar). `padContent` insets the content area (tasks),
// since the page itself is edge-to-edge.
// ---------------------------------------------------------------------------

export const SidebarShell = ({
	label,
	top,
	bottom,
	children,
	gap = true,
	padContent = false,
}: {
	/** Accessible label for the sidebar landmark (e.g. "Calendars"). */
	readonly label: string;
	/** Scrollable upper region — primary action + the list. */
	readonly top: ComponentChildren;
	/** Pinned lower region — import/export/tools. */
	readonly bottom: ComponentChildren;
	/** Main content beside the sidebar. */
	readonly children: ComponentChildren;
	/** Keep a gutter between the aside and the content (default true). */
	readonly gap?: boolean;
	/** Inset the content area with padding (default false). */
	readonly padContent?: boolean;
}): VNode => (
	<div
		class={cx(
			"flex flex-col lg:h-full lg:flex-row lg:items-stretch",
			gap ? "gap-6" : "",
		)}
	>
		<aside
			aria-label={label}
			class="card flex w-full flex-col rounded-none lg:h-full lg:w-72 lg:shrink-0"
		>
			<div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
				{top}
			</div>
			<div class="shrink-0 space-y-2 border-t border-line p-3">{bottom}</div>
		</aside>
		<div
			class={cx(
				"flex min-w-0 flex-1 flex-col gap-4 lg:h-full lg:min-h-0",
				padContent ? "p-4" : "",
			)}
		>
			{children}
		</div>
	</div>
);
