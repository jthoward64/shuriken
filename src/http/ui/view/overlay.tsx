import type { ComponentChildren, VNode } from "preact";
import { cx } from "./cx.ts";
import { IconChevronDown } from "./icons.tsx";

// ---------------------------------------------------------------------------
// Overlays - modal dialogs and dropdown menus.
//
// Both are JavaScript-free. `Modal` is a native <dialog> opened by a
// `<button commandfor command="show-modal">` elsewhere in the document, so its
// content is present and fully populated at load. `Menu` is a native <details>
// that opens on click, hover and keyboard focus (see the .menu rules in
// styles/input.css).
//
// `Modal` generalizes the older `InlineModalPopover` in ui.tsx by owning the
// title and footer rows; that component stays for the pages already built on
// it and forwards the same markup.
// ---------------------------------------------------------------------------

export interface ModalProps {
	/** Target of the opening control's `commandfor`. */
	readonly id: string;
	readonly title: string;
	/** Action row pinned under the content, usually Cancel plus a submit. */
	readonly footer?: ComponentChildren;
	readonly class?: string;
	readonly children: ComponentChildren;
}

export const Modal = ({
	id,
	title,
	footer,
	class: cls,
	children,
}: ModalProps): VNode => (
	<dialog id={id} aria-labelledby={`${id}-title`} class="modal-popover">
		<div class={cx("modal-popover-panel card card-pad", cls)}>
			<div class="modal-header">
				<h2 id={`${id}-title`} class="card-title">
					{title}
				</h2>
				<button
					type="button"
					command="close"
					commandfor={id}
					class="modal-close"
					aria-label="Close"
				>
					×
				</button>
			</div>
			<div class="modal-body">{children}</div>
			{footer !== undefined && <div class="modal-footer">{footer}</div>}
		</div>
	</dialog>
);

/** Button that opens a `Modal` by id, with no script involved */
export const ModalTrigger = ({
	modalId,
	class: cls,
	children,
}: {
	modalId: string;
	class?: string;
	children: ComponentChildren;
}): VNode => (
	<button type="button" command="show-modal" commandfor={modalId} class={cls}>
		{children}
	</button>
);

export interface MenuProps {
	readonly label: ComponentChildren;
	/** Anchor the panel to the trigger's left edge instead of its right. */
	readonly align?: "start" | "end";
	/** Class for the <summary> trigger, e.g. a btn or nav-link. */
	readonly triggerClass?: string;
	readonly class?: string;
	readonly children: ComponentChildren;
}

export const Menu = ({
	label,
	align = "end",
	triggerClass,
	class: cls,
	children,
}: MenuProps): VNode => (
	<details class={cx("menu", cls)}>
		<summary class={triggerClass}>
			{label}
			<IconChevronDown class="menu-caret w-3.5 h-3.5" />
		</summary>
		<div class={cx("menu-panel", align === "start" && "menu-panel-left")}>
			{children}
		</div>
	</details>
);

/** Non-interactive heading inside a Menu panel */
export const MenuLabel = ({
	children,
}: {
	children: ComponentChildren;
}): VNode => <p class="menu-label">{children}</p>;

export const MenuItem = ({
	href,
	class: cls,
	children,
	...rest
}: {
	href?: string;
	class?: string;
	children: ComponentChildren;
	[key: string]: unknown;
}): VNode =>
	href !== undefined ? (
		<a {...rest} href={href} class={cx("menu-item", cls)}>
			{children}
		</a>
	) : (
		<button {...rest} type="button" class={cx("menu-item", "w-full", cls)}>
			{children}
		</button>
	);
