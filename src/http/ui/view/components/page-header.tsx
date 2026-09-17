import type { ComponentChildren } from "preact";

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
