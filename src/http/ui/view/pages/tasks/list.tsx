import type { VNode } from "preact";
import { Breadcrumb, buttonClass, PageHeader } from "../../ui.tsx";
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
		<h2 class="px-1 text-xs font-semibold uppercase tracking-wider text-subtle">
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
						<span class="badge shrink-0" title={`Shared by ${c.ownerSlug}`}>
							{c.ownerSlug}
						</span>
					)}
				</li>
			))}
		</ul>
	</div>
);

const StatusBadge = ({ row }: { row: TaskRow }): VNode => {
	const cls = row.completed
		? "badge bg-success/10 text-success"
		: row.status === "CANCELLED"
			? "badge bg-surface-2 text-subtle"
			: row.overdue
				? "badge bg-danger/10 text-danger"
				: "badge";
	return <span class={cls}>{row.statusLabel}</span>;
};

const TaskTable = ({
	tasks,
	writable,
	collectionId,
}: {
	tasks: ReadonlyArray<TaskRow>;
	writable: boolean;
	collectionId: string;
}): VNode => (
	<div class="table-wrap">
		<table class="table">
			<thead>
				<tr>
					<th class="w-8 sr-only">Done</th>
					<th>Title</th>
					<th>Due</th>
					<th>Priority</th>
					<th>Status</th>
					<th />
				</tr>
			</thead>
			<tbody>
				{tasks.map((t) => (
					<tr key={t.id}>
						<td>
							<form
								method="POST"
								action={`/ui/api/tasks/${collectionId}/tasks/${t.id}/toggle`}
								class="contents"
							>
								<button
									type="submit"
									disabled={!writable}
									aria-label={t.completed ? "Mark as not done" : "Mark as done"}
									class="flex h-5 w-5 items-center justify-center rounded border border-line text-xs disabled:opacity-40"
								>
									{t.completed ? "✓" : ""}
								</button>
							</form>
						</td>
						<td class={t.completed ? "text-muted line-through" : "text-fg"}>
							{t.title}
							{t.recurring && (
								<span class="ml-1 text-xs text-subtle">(repeats)</span>
							)}
						</td>
						<td class={t.overdue ? "text-danger" : "text-muted"}>
							{t.dueLabel}
						</td>
						<td class="text-muted">{t.priorityLabel ?? "—"}</td>
						<td>
							<StatusBadge row={t} />
						</td>
						<td class="text-right">
							<a
								href={`/ui/tasks/${t.id}`}
								target="_blank"
								rel="noopener"
								class="link"
							>
								Open
							</a>
						</td>
					</tr>
				))}
			</tbody>
		</table>
	</div>
);

const Pagination = ({
	selectedId,
	showCompleted,
	page,
	totalPages,
}: {
	selectedId: string;
	showCompleted: boolean;
	page: number;
	totalPages: number;
}): VNode | null => {
	if (totalPages <= 1) {
		return null;
	}
	return (
		<nav
			aria-label="Tasks pages"
			class="flex items-center justify-between gap-2 pt-1 text-sm text-muted"
		>
			{page > 1 ? (
				<a
					href={listUrl(selectedId, showCompleted, page - 1)}
					class="btn btn-secondary btn-sm"
				>
					Previous
				</a>
			) : (
				<span class="btn btn-secondary btn-sm opacity-50" aria-disabled="true">
					Previous
				</span>
			)}
			<span>
				Page {page} of {totalPages}
			</span>
			{page < totalPages ? (
				<a
					href={listUrl(selectedId, showCompleted, page + 1)}
					class="btn btn-secondary btn-sm"
				>
					Next
				</a>
			) : (
				<span class="btn btn-secondary btn-sm opacity-50" aria-disabled="true">
					Next
				</span>
			)}
		</nav>
	);
};

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
				<h1 class="page-title">Tasks</h1>
				<p class="text-sm text-muted">
					No calendar available. Create one from your profile.
				</p>
			</div>
		);
	}

	return (
		<SidebarShell
			label="Calendars"
			top={<CalendarList calendars={calendars} showCompleted={showCompleted} />}
			bottom={null}
		>
			<div>
				<Breadcrumb items={[{ label: "Tasks" }]} />
				<PageHeader
					title="Tasks"
					actions={
						selectedWritable && (
							<a
								href={`/ui/tasks/new?calendar=${selectedId}`}
								class={buttonClass("primary")}
							>
								New task
							</a>
						)
					}
				/>
			</div>

			<form method="GET" action="/ui/tasks" class="flex items-center gap-2">
				<input type="hidden" name="calendar" value={selectedId} />
				<label class="flex items-center gap-2 text-sm text-muted">
					<input
						type="checkbox"
						name="completed"
						value="1"
						checked={showCompleted}
						class="rounded"
					/>
					Show completed
				</label>
				<button type="submit" class="btn btn-secondary btn-sm">
					Apply
				</button>
			</form>

			{tasks.length === 0 ? (
				<p class="text-sm text-muted">No tasks here.</p>
			) : (
				<TaskTable
					tasks={tasks}
					writable={selectedWritable}
					collectionId={selectedId}
				/>
			)}

			<Pagination
				selectedId={selectedId}
				showCompleted={showCompleted}
				page={page}
				totalPages={totalPages}
			/>
		</SidebarShell>
	);
};
