import type { VNode } from "preact";
import type { RecurrenceFreq } from "#src/services/cal-edit/types.ts";
import type {
	TaskFormData,
	TaskStatus,
} from "#src/services/task-edit/types.ts";
import { Breadcrumb, Card, PageHeader } from "../../ui.tsx";

// ---------------------------------------------------------------------------
// Task create/edit form. Mirrors EventFormBody/EventFormPage (calendar/
// event-form.tsx) with VTODO's fields (due date instead of start/end,
// status/priority/percent-complete) in place of VEVENT's (attendees,
// organizer aren't exposed for tasks in v1).
// ---------------------------------------------------------------------------

const FREQ_OPTIONS: ReadonlyArray<{ value: RecurrenceFreq; label: string }> = [
	{ value: "", label: "None" },
	{ value: "DAILY", label: "Daily" },
	{ value: "WEEKLY", label: "Weekly" },
	{ value: "MONTHLY", label: "Monthly" },
	{ value: "YEARLY", label: "Yearly" },
];

const STATUS_OPTIONS: ReadonlyArray<{ value: TaskStatus; label: string }> = [
	{ value: "", label: "(unset)" },
	{ value: "NEEDS-ACTION", label: "Needs action" },
	{ value: "IN-PROCESS", label: "In process" },
	{ value: "COMPLETED", label: "Completed" },
	{ value: "CANCELLED", label: "Cancelled" },
];

export interface TaskFormBodyProps {
	readonly form: TaskFormData;
}

export const TaskFormBody = ({ form }: TaskFormBodyProps): VNode => (
	<div class="space-y-5">
		<div class="form-group">
			<label for="summary" class="form-label">
				Title <span class="text-danger">*</span>
			</label>
			<input
				required
				autofocus
				type="text"
				id="summary"
				name="summary"
				value={form.summary}
				class="form-input"
			/>
		</div>

		<div class="flex items-center gap-2">
			{form.allDay ? (
				<input
					id="allDay"
					type="checkbox"
					name="allDay"
					checked
					class="rounded"
				/>
			) : (
				<input id="allDay" type="checkbox" name="allDay" class="rounded" />
			)}
			<label for="allDay" class="text-sm text-fg">
				All-day (dates instead of date/times)
			</label>
		</div>

		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<div class="form-group">
				<label for="start" class="form-label">
					Start
				</label>
				<input
					type="text"
					id="start"
					name="start"
					value={form.start}
					placeholder="YYYY-MM-DDTHH:mm or YYYY-MM-DD"
					class="form-input"
				/>
			</div>
			<div class="form-group">
				<label for="due" class="form-label">
					Due
				</label>
				<input
					type="text"
					id="due"
					name="due"
					value={form.due}
					placeholder="YYYY-MM-DDTHH:mm or YYYY-MM-DD"
					class="form-input"
				/>
			</div>
		</div>

		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<div class="form-group">
				<label for="status" class="form-label">
					Status
				</label>
				<select id="status" name="status" class="form-select">
					{STATUS_OPTIONS.map((o) =>
						o.value === form.status ? (
							<option key={o.value} value={o.value} selected>
								{o.label}
							</option>
						) : (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						),
					)}
				</select>
			</div>
			<div class="form-group">
				<label for="priority" class="form-label">
					Priority (0-9, lower = more important)
				</label>
				<input
					type="number"
					min={0}
					max={9}
					id="priority"
					name="priority"
					value={form.priority}
					class="form-input"
				/>
			</div>
			<div class="form-group">
				<label for="percentComplete" class="form-label">
					Percent complete
				</label>
				<input
					type="number"
					min={0}
					max={100}
					id="percentComplete"
					name="percentComplete"
					value={form.percentComplete}
					class="form-input"
				/>
			</div>
		</div>

		<div class="form-group">
			<label for="location" class="form-label">
				Location
			</label>
			<input
				type="text"
				id="location"
				name="location"
				value={form.location}
				class="form-input"
			/>
		</div>

		<div class="form-group">
			<label for="description" class="form-label">
				Description
			</label>
			<textarea
				id="description"
				name="description"
				rows={3}
				class="form-textarea"
				value={form.description}
			/>
		</div>

		<div class="form-group">
			<label for="categoriesCsv" class="form-label">
				Categories (comma-separated)
			</label>
			<input
				type="text"
				id="categoriesCsv"
				name="categoriesCsv"
				value={form.categoriesCsv}
				class="form-input"
			/>
		</div>

		<fieldset class="space-y-3 rounded border border-line p-4">
			<legend class="form-label px-1">Repeat</legend>
			<div class="form-group">
				<label for="recurrenceFreq" class="form-label">
					Frequency
				</label>
				<select id="recurrenceFreq" name="recurrenceFreq" class="form-select">
					{FREQ_OPTIONS.map((o) =>
						o.value === form.recurrenceFreq ? (
							<option key={o.value} value={o.value} selected>
								{o.label}
							</option>
						) : (
							<option key={o.value} value={o.value}>
								{o.label}
							</option>
						),
					)}
				</select>
			</div>
			<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
				<div class="form-group">
					<label for="recurrenceCount" class="form-label">
						Occurrence count
					</label>
					<input
						type="number"
						min={1}
						id="recurrenceCount"
						name="recurrenceCount"
						value={form.recurrenceCount}
						class="form-input"
					/>
				</div>
				<div class="form-group">
					<label for="recurrenceUntil" class="form-label">
						Or until
					</label>
					<input
						type="date"
						id="recurrenceUntil"
						name="recurrenceUntil"
						value={form.recurrenceUntil}
						class="form-input"
					/>
				</div>
			</div>
			<p class="form-hint">Count wins over Until when both are set.</p>
		</fieldset>
	</div>
);

export interface TaskFormPageProps {
	readonly mode: "new" | "edit";
	readonly title: string;
	readonly form: TaskFormData;
	/** Submit target (create or update). */
	readonly action: string;
	/** Delete target — only used in edit mode. */
	readonly deleteAction?: string;
	readonly backHref: string;
}

export const TaskFormPage = ({
	mode,
	title,
	form,
	action,
	deleteAction,
	backHref,
}: TaskFormPageProps): VNode => (
	<div class="mx-auto max-w-2xl space-y-6">
		<div>
			<Breadcrumb
				items={[{ label: "Tasks", href: backHref }, { label: title }]}
			/>
			<PageHeader title={title} />
		</div>

		<Card>
			<form method="POST" action={action}>
				<TaskFormBody form={form} />
				<div class="flex flex-wrap gap-3 pt-5">
					<button type="submit" class="btn btn-primary">
						{mode === "edit" ? "Save changes" : "Create task"}
					</button>
					<a href={backHref} class="btn btn-secondary">
						Cancel
					</a>
				</div>
			</form>
		</Card>

		{mode === "edit" && deleteAction && (
			<Card>
				<form
					method="POST"
					action={deleteAction}
					data-confirm="Delete this task?"
				>
					<h2 class="mb-2 text-sm font-semibold text-danger">Danger zone</h2>
					<button type="submit" class="btn btn-danger">
						Delete task
					</button>
				</form>
			</Card>
		)}
	</div>
);
