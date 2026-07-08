import type { ComponentChildren } from "preact";
import { cx } from "./cx.ts";

// ---------------------------------------------------------------------------
// Shared structural components. Thin, typed wrappers over the design-system CSS
// classes (see styles/input.css). Pages may also use the raw classes directly;
// these just remove boilerplate for the common shapes.
// ---------------------------------------------------------------------------

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
	primary: "btn-primary",
	secondary: "btn-secondary",
	danger: "btn-danger",
	ghost: "btn-ghost",
};

// Class string for a button/link styled as a button.
export const buttonClass = (
	variant: ButtonVariant = "secondary",
	extra?: string,
): string => cx("btn", VARIANT_CLASS[variant], extra);

export const PageHeader = ({
	title,
	subtitle,
	actions,
}: {
	title: string;
	subtitle?: string;
	actions?: ComponentChildren;
}) => (
	<div class="page-header">
		<div>
			<h1 class="page-title">{title}</h1>
			{subtitle && <p class="page-subtitle">{subtitle}</p>}
		</div>
		{actions && <div class="page-actions">{actions}</div>}
	</div>
);

// Breadcrumb trail shown above a page title. Items render left-to-right with
// "/" separators; the last (or any without an href) renders as plain text.
export const Breadcrumb = ({
	items,
}: {
	items: ReadonlyArray<{ label: string; href?: string }>;
}) => (
	<nav aria-label="Breadcrumb" class="mb-2 flex items-center gap-2 text-sm">
		{items.map((it, i) => (
			<>
				{i > 0 && <span class="text-subtle">/</span>}
				{it.href ? (
					<a href={it.href} class="link">
						{it.label}
					</a>
				) : (
					<span class="text-muted">{it.label}</span>
				)}
			</>
		))}
	</nav>
);

// Validation-error summary. Rendered as an HTMX fragment on failed form posts;
// returns an empty fragment when there is nothing to show. `errors` is the
// field-keyed message map produced by `validationErrorToContext`.
export const FormErrors = ({ errors }: { errors: Record<string, string> }) => {
	const messages = Object.values(errors);
	if (messages.length === 0) {
		return null;
	}
	return (
		<div
			role="alert"
			class="mb-4 rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
		>
			<p class="mb-1 font-medium">Please correct the following errors:</p>
			<ul class="list-inside list-disc space-y-0.5">
				{messages.map((m) => (
					<li key={m}>{m}</li>
				))}
			</ul>
		</div>
	);
};

export const Card = ({
	title,
	actions,
	pad = true,
	class: cls,
	children,
}: {
	title?: string;
	actions?: ComponentChildren;
	pad?: boolean;
	class?: string;
	children: ComponentChildren;
}) => (
	<div class={cx("card", cls)}>
		{title && (
			<div class="card-header">
				<h2 class="card-title">{title}</h2>
				{actions}
			</div>
		)}
		<div class={pad ? "card-pad" : undefined}>{children}</div>
	</div>
);

// A modal dialog (styled by `.modal-popover`). The content is rendered inline
// (present in the DOM at load) so a `<button commandfor={id} command="show-modal">`
// opens a fully-populated dialog with zero JS. For lazily-loaded dialogs, use
// the section-specific *PopoverContainer instead.
export const InlineModalPopover = ({
	id,
	children,
}: {
	id: string;
	children: ComponentChildren;
}) => (
	<dialog id={id} aria-labelledby={`${id}-title`} class="modal-popover">
		<div class="modal-popover-panel card card-pad">{children}</div>
	</dialog>
);
