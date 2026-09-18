import type { ComponentChildren, JSX, VNode } from "preact";
import { cx } from "./cx.ts";

// ---------------------------------------------------------------------------
// Display components - badges, tables and empty states.
//
// `Table` takes its columns as data rather than as markup so header and cell
// alignment cannot drift apart, and so a list with nothing in it renders an
// `EmptyState` instead of an empty grid without every caller remembering to
// handle that case.
// ---------------------------------------------------------------------------

export type BadgeTone = "neutral" | "brand" | "success" | "danger" | "warning";

const TONE_CLASS: Record<BadgeTone, string | undefined> = {
	neutral: undefined,
	brand: "badge-brand",
	success: "badge-success",
	danger: "badge-danger",
	warning: "badge-warning",
};

export type BadgeProps = Omit<JSX.HTMLAttributes<HTMLSpanElement>, "class"> & {
	readonly tone?: BadgeTone;
	readonly class?: string;
	readonly children: ComponentChildren;
};

export const Badge = ({
	tone = "neutral",
	class: cls,
	children,
	...rest
}: BadgeProps): VNode => (
	<span {...rest} class={cx("badge", TONE_CLASS[tone], cls)}>
		{children}
	</span>
);

export const EmptyState = ({
	title,
	description,
	action,
	class: cls,
}: {
	title: string;
	description?: string;
	/** Usually a Button or LinkButton offering the obvious next step. */
	action?: ComponentChildren;
	class?: string;
}): VNode => (
	<div class={cx("empty-state", cls)}>
		<p class="empty-state-title">{title}</p>
		{description !== undefined && <p class="empty-state-desc">{description}</p>}
		{action !== undefined && <div class="empty-state-action">{action}</div>}
	</div>
);

export interface Column<T> {
	readonly header: string;
	readonly cell: (row: T) => ComponentChildren;
	readonly align?: "left" | "right" | "center";
	/** Collapse the column to its content width (for action cells). */
	readonly shrink?: boolean;
	/** Keep the header for screen readers but hide it visually. */
	readonly headerHidden?: boolean;
}

const ALIGN_CLASS: Record<"left" | "right" | "center", string | undefined> = {
	left: undefined,
	right: "text-right",
	center: "text-center",
};

export interface TableProps<T> {
	readonly columns: ReadonlyArray<Column<T>>;
	readonly rows: ReadonlyArray<T>;
	readonly getKey: (row: T) => string;
	/** Shown in place of the table when there are no rows. */
	readonly empty?: ComponentChildren;
	readonly class?: string;
}

export const Table = <T,>({
	columns,
	rows,
	getKey,
	empty,
	class: cls,
}: TableProps<T>): VNode => {
	if (rows.length === 0 && empty !== undefined) {
		return <>{empty}</>;
	}
	return (
		<div class={cx("table-wrap", cls)}>
			<table class="table">
				<thead>
					<tr>
						{columns.map((c) => (
							<th
								key={c.header}
								class={cx(
									ALIGN_CLASS[c.align ?? "left"],
									c.shrink && "w-0",
									c.headerHidden && "sr-only",
								)}
							>
								{/* Action columns have no meaningful heading but still need a cell */}
								{c.header === "" ? null : c.header}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr key={getKey(row)}>
							{columns.map((c) => (
								<td
									key={c.header}
									class={cx(ALIGN_CLASS[c.align ?? "left"], "text-fg")}
								>
									{c.cell(row)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
};

export type CardProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, "class"> & {
	readonly title?: string;
	readonly actions?: ComponentChildren;
	readonly pad?: boolean;
	readonly class?: string;
	readonly children: ComponentChildren;
};

export const Card = ({
	title,
	actions,
	pad = true,
	class: cls,
	children,
	...rest
}: CardProps) => (
	<div {...rest} class={cx("card", cls)}>
		{title ? (
			<div class="card-header">
				<h2 class="card-title">{title}</h2>
				{actions}
			</div>
		) : null}
		<div class={pad ? "card-pad" : undefined}>{children}</div>
	</div>
);

export type AlertTone = "info" | "success" | "warning" | "danger";

const ALERT_CLASS: Record<AlertTone, string> = {
	info: "border-line bg-surface-2 text-fg",
	success: "border-success/40 bg-success/10 text-success",
	warning: "border-warning/40 bg-warning/10 text-warning",
	danger: "border-danger/40 bg-danger/10 text-danger",
};

// Inline callout for the result of an action or a caveat about one. `role`
// defaults to "alert" for the tones that report a problem so assistive tech
// announces them; informational callouts stay silent.
export const Alert = ({
	tone = "info",
	title,
	class: cls,
	children,
}: {
	tone?: AlertTone;
	title?: string;
	class?: string;
	children?: ComponentChildren;
}): VNode => (
	<div
		role={tone === "danger" || tone === "warning" ? "alert" : undefined}
		class={cx("rounded-md border px-4 py-3 text-sm", ALERT_CLASS[tone], cls)}
	>
		{title !== undefined && <p class="mb-1 font-medium">{title}</p>}
		{children}
	</div>
);
