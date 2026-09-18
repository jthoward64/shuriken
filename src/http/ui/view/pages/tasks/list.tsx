import type { VNode } from "preact";
import { Button, LinkButton } from "../../components/button.tsx";
import {
	Badge,
	type BadgeTone,
	type Column,
	EmptyState,
	Table,
} from "../../components/display.tsx";
import { Checkbox } from "../../components/form/form.tsx";
import { Breadcrumb, PageHeader } from "../../components/page-header.tsx";
import { Pagination } from "../../components/pagination.tsx";

import { SidebarShell } from "../sidebar-shell.tsx";

// ---------------------------------------------------------------------------
// Tasks list page — one calendar's VTODOs in a plain sortable table (no
// FullCalendar grid; recurrence just shows a "repeats" label like the
// calendar page's no-JS event list). Mirrors the Contacts list page's
// sidebar + table + pagination shape.
// ---------------------------------------------------------------------------

export interface CalendarOption {
	readonly id: string;
	readonly displayName: string;
	readonly selected: boolean;
	/** Owner's slug when shared with the caller; null when the caller owns it. */
	readonly ownerSlug: string | null;
	readonly writable: boolean;
}

export interface TaskRow {
	readonly id: string;
	readonly title: string;
	/** Human label, e.g. "Due Mon, Jan 5" or "No due date". */
	readonly dueLabel: string;
	readonly overdue: boolean;
	readonly status: string;
	readonly statusLabel: string;
	readonly completed: boolean;
	readonly priorityLabel: string | null;
	readonly recurring: boolean;
}

export interface TasksListPageProps {
	readonly calendars: ReadonlyArray<CalendarOption>;
	readonly selectedId: string;
	readonly selectedWritable: boolean;
	readonly hasCalendar: boolean;
	readonly showCompleted: boolean;
	readonly tasks: ReadonlyArray<TaskRow>;
	readonly page: number;
	readonly totalPages: number;
}

const listUrl = (
	selectedId: string,
	showCompleted: boolean,
	page = 1,
): string => {
	const params = new URLSearchParams();
	if (selectedId !== "") {
		params.set("calendar", selectedId);
	}
	if (showCompleted) {
		params.set("completed", "1");
	}
	if (page > 1) {
		params.set("page", String(page));
	}
	const qs = params.toString();
	return qs === "" ? "/ui/tasks" : `/ui/tasks?${qs}`;
};

const calendarHref = (id: string, showCompleted: boolean): string => {
	const params = new URLSearchParams();
	params.set("calendar", id);
	if (showCompleted) {
		params.set("completed", "1");
	}
	return `/ui/tasks?${params.toString()}`;
};

const CalendarList = ({
	calendars,
	showCompleted,
}: {
	calendars: ReadonlyArray<CalendarOption>;
	showCompleted: boolean;
}): VNode => (
	<div class="space-y-2">
		<h2 class="px-1 font-semibold text-subtle text-xs uppercase tracking-wider">
			Calendars
		</h2>
		<ul class="space-y-0.5">
			{calendars.map((c) => (
				<li key={c.id} class="flex items-center gap-1">
					<a
						href={calendarHref(c.id, showCompleted)}
						aria-current={c.selected ? "true" : undefined}
						class={`block min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-sm ${
							c.selected
								? "bg-surface-2 font-semibold text-fg"
								: "text-muted hover:bg-surface-2"
						}`}
					>
						{c.displayName}
					</a>
					{c.ownerSlug !== null && (
						<Badge class="shrink-0" title={`Shared by ${c.ownerSlug}`}>
							{c.ownerSlug}
						</Badge>
					)}
				</li>
			))}
		</ul>
	</div>
);

const statusTone = (row: TaskRow): BadgeTone => {
	if (row.completed) {
		return "success";
	}
	if (row.status !== "CANCELLED" && row.overdue) {
		return "danger";
	}
	return "neutral";
};

const StatusBadge = ({ row }: { row: TaskRow }): VNode => (
	<Badge tone={statusTone(row)}>{row.statusLabel}</Badge>
);

const taskColumns = (
	writable: boolean,
	collectionId: string,
): ReadonlyArray<Column<TaskRow>> => [
	{
		header: "Done",
		headerHidden: true,
		shrink: true,
		cell: (t) => (
			<form
				method="POST"
				action={`/ui/api/tasks/${collectionId}/tasks/${t.id}/toggle`}
				class="contents"
			>
				<button
					type="submit"
					disabled={!writable}
					aria-label={t.completed ? "Mark as not done" : "Mark as done"}
					class="flex size-5 items-center justify-center rounded border border-line text-xs disabled:opacity-40"
				>
					{t.completed ? "✓" : ""}
				</button>
			</form>
		),
	},
	{
		header: "Title",
		cell: (t) => (
			<span class={t.completed ? "text-muted line-through" : undefined}>
				{t.title}
				{t.recurring ? (
					<span class="ml-1 text-subtle text-xs">(repeats)</span>
				) : null}
			</span>
		),
	},
	{
		header: "Due",
		cell: (t) => (
			<span class={t.overdue ? "text-danger" : "text-muted"}>{t.dueLabel}</span>
		),
	},
	{
		header: "Priority",
		cell: (t) => <span class="text-muted">{t.priorityLabel ?? "—"}</span>,
	},
	{ header: "Status", cell: (t) => <StatusBadge row={t} /> },
	{
		header: "",
		align: "right",
		shrink: true,
		cell: (t) => (
			<a href={`/ui/tasks/${t.id}`} target="_blank" rel="noopener" class="link">
				Open
			</a>
		),
	},
];

export const TasksListPage = ({
	calendars,
	selectedId,
	selectedWritable,
	hasCalendar,
	showCompleted,
	tasks,
	page,
	totalPages,
}: TasksListPageProps): VNode => {
	if (!hasCalendar) {
		return (
			<div class="space-y-4">
				<PageHeader title="Tasks" />
				<EmptyState
					title="No calendar available."
					description="Create one from your profile."
				/>
			</div>
		);
	}

	return (
		<SidebarShell
			label="Calendars"
			padContent
			top={<CalendarList calendars={calendars} showCompleted={showCompleted} />}
			bottom={null}
		>
			<div>
				<Breadcrumb items={[{ label: "Tasks" }]} />
				<PageHeader
					title="Tasks"
					actions={
						selectedWritable && (
							<LinkButton
								href={`/ui/tasks/new?calendar=${selectedId}`}
								variant="primary"
							>
								New task
							</LinkButton>
						)
					}
				/>
			</div>

			<form method="GET" action="/ui/tasks" class="flex items-center gap-2">
				<input type="hidden" name="calendar" value={selectedId} />
				<Checkbox
					id="show-completed"
					label="Show completed"
					name="completed"
					value="1"
					checked={showCompleted}
				/>
				<Button type="submit" size="sm">
					Apply
				</Button>
			</form>

			<Table
				columns={taskColumns(selectedWritable, selectedId)}
				rows={tasks}
				getKey={(t) => t.id}
				empty={<EmptyState title="No tasks here." />}
			/>

			<Pagination
				label="Tasks pages"
				page={page}
				totalPages={totalPages}
				hrefFor={(n) => listUrl(selectedId, showCompleted, n)}
			/>
		</SidebarShell>
	);
};
