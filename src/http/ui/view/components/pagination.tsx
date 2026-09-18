import type { VNode } from "preact";
import { buttonClass, LinkButton } from "./button.tsx";

// ---------------------------------------------------------------------------
// Previous / Next pager for the list pages.
//
// Link-based rather than scripted, so it works with the page's own query
// string and needs no JS. `hrefFor` builds the URL for a page number; the ends
// of the range render as disabled-looking spans instead of links, because
// there is nowhere to navigate to.
// ---------------------------------------------------------------------------

export interface PaginationProps {
	readonly page: number;
	readonly totalPages: number;
	readonly hrefFor: (page: number) => string;
	/** Names the nav for assistive tech, e.g. "Contacts pages". */
	readonly label: string;
}

const DisabledStep = ({ children }: { children: string }): VNode => (
	<span
		class={buttonClass("secondary", "btn-sm opacity-50")}
		aria-disabled="true"
	>
		{children}
	</span>
);

export const Pagination = ({
	page,
	totalPages,
	hrefFor,
	label,
}: PaginationProps): VNode | null => {
	if (totalPages <= 1) {
		return null;
	}
	return (
		<nav
			aria-label={label}
			class="flex items-center justify-between gap-2 pt-1 text-muted text-sm"
		>
			{page > 1 ? (
				<LinkButton href={hrefFor(page - 1)} size="sm">
					Previous
				</LinkButton>
			) : (
				<DisabledStep>Previous</DisabledStep>
			)}
			<span>
				Page {page} of {totalPages}
			</span>
			{page < totalPages ? (
				<LinkButton href={hrefFor(page + 1)} size="sm">
					Next
				</LinkButton>
			) : (
				<DisabledStep>Next</DisabledStep>
			)}
		</nav>
	);
};
