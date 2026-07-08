import type { ComponentChildren } from "preact";
import type { NavContext } from "#src/http/ui/helpers/nav-context.ts";
import { cx } from "./cx.ts";
import { IconChevronDown } from "./icons.tsx";

// ---------------------------------------------------------------------------
// Primary navigation — shared between the desktop and mobile nav slots in the
// layout. Dropdowns are native <details> so they work without JavaScript; a
// small enhancement script (in Layout) closes them on outside-click.
//
// IA: Calendar (Subscriptions + Feeds now live on the calendar page sidebar),
// Contacts, and an Admin menu (Users / Groups) for privileged users. Shared
// calendars/address books are merged into the Calendar/Contacts sidebars
// rather than living on their own page. See nav-context.ts for the section
// mapping that drives highlighting.
// ---------------------------------------------------------------------------

const MenuItem = ({
	href,
	current,
	children,
}: {
	href: string;
	current: boolean;
	children: ComponentChildren;
}) => (
	<a href={href} class="menu-item" aria-current={current ? "page" : undefined}>
		{children}
	</a>
);

// Dropdown menu. If `href` is set, the label itself is a link (clicking it
// navigates); the dropdown still opens on hover/focus/click. Otherwise the label
// only toggles the menu.
const Menu = ({
	label,
	href,
	active,
	children,
}: {
	label: string;
	href?: string;
	active: boolean;
	children: ComponentChildren;
}) => (
	<details class="menu">
		<summary class={cx("nav-link", active && "is-active")}>
			{href ? <a href={href}>{label}</a> : <span>{label}</span>}
			<IconChevronDown class="menu-caret w-3.5 h-3.5" />
		</summary>
		<div class="menu-panel menu-panel-left">{children}</div>
	</details>
);

export const Nav = ({ nav }: { nav: NavContext }) => {
	const { currentPath, activeSection } = nav;
	return (
		<>
			{nav.showCalendar && (
				<a
					href="/ui/calendar"
					class={cx("nav-link", activeSection === "calendar" && "is-active")}
				>
					Calendar
				</a>
			)}

			{nav.showTasks && (
				<a
					href="/ui/tasks"
					class={cx("nav-link", activeSection === "tasks" && "is-active")}
				>
					Tasks
				</a>
			)}

			{nav.showContacts && (
				<a
					href="/ui/contacts"
					class={cx("nav-link", activeSection === "contacts" && "is-active")}
				>
					Contacts
				</a>
			)}

			{nav.showTrash && (
				<a
					href="/ui/trash"
					class={cx("nav-link", activeSection === "trash" && "is-active")}
				>
					Trash
				</a>
			)}

			{nav.showAdmin && (
				<Menu label="Admin" active={activeSection === "admin"}>
					{nav.showUsers && (
						<MenuItem href="/ui/users" current={currentPath === "/ui/users"}>
							Users
						</MenuItem>
					)}
					{nav.showGroups && (
						<MenuItem href="/ui/groups" current={currentPath === "/ui/groups"}>
							Groups
						</MenuItem>
					)}
				</Menu>
			)}
		</>
	);
};
