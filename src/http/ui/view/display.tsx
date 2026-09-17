import type { ComponentChildren, VNode } from "preact";
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

export const Badge = ({
	tone = "neutral",
	class: cls,
	children,
}: {
	tone?: BadgeTone;
	class?: string;
	children: ComponentChildren;
}): VNode => <span class={cx("badge", TONE_CLASS[tone], cls)}>{children}</span>;

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
								class={cx(ALIGN_CLASS[c.align ?? "left"], c.shrink && "w-0")}
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
