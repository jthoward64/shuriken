import type { VNode } from "preact";
import type { RecurrenceFreq } from "#src/services/cal-edit/types.ts";
import type {
	TaskFormData,
	TaskStatus,
} from "#src/services/task-edit/types.ts";
import { Button, LinkButton } from "../../components/button.tsx";
import { Card } from "../../components/display.tsx";
import {
	Checkbox,
	Field,
	Textarea,
	TextInput,
} from "../../components/form/form.tsx";
import { Select } from "../../components/form/select.tsx";
import { Breadcrumb, PageHeader } from "../../components/page-header.tsx";

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
		<Field for="summary" label="Title" required>
			<TextInput
				required
				autofocus
				id="summary"
				name="summary"
				value={form.summary}
			/>
		</Field>

		<Checkbox
			id="allDay"
			label="All-day (dates instead of date/times)"
			name="allDay"
			checked={form.allDay}
		/>

		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<Field for="start" label="Start">
				<TextInput
					id="start"
					name="start"
					value={form.start}
					placeholder="YYYY-MM-DDTHH:mm or YYYY-MM-DD"
				/>
			</Field>
			<Field for="due" label="Due">
				<TextInput
					id="due"
					name="due"
					value={form.due}
					placeholder="YYYY-MM-DDTHH:mm or YYYY-MM-DD"
				/>
			</Field>
		</div>

		<div class="grid grid-cols-1 gap-4 md:grid-cols-3">
			<Field for="status" label="Status">
				<Select
					id="status"
					name="status"
					options={STATUS_OPTIONS}
					value={form.status}
				/>
			</Field>
			<Field for="priority" label="Priority (0-9, lower = more important)">
				<TextInput
					type="number"
					min={0}
					max={9}
					id="priority"
					name="priority"
					value={form.priority}
				/>
			</Field>
			<Field for="percentComplete" label="Percent complete">
				<TextInput
					type="number"
					min={0}
					max={100}
					id="percentComplete"
					name="percentComplete"
					value={form.percentComplete}
				/>
			</Field>
		</div>

		<Field for="location" label="Location">
			<TextInput id="location" name="location" value={form.location} />
		</Field>

		<Field for="description" label="Description">
			<Textarea id="description" name="description" value={form.description} />
		</Field>

		<Field for="categoriesCsv" label="Categories (comma-separated)">
			<TextInput
				id="categoriesCsv"
				name="categoriesCsv"
				value={form.categoriesCsv}
			/>
		</Field>

		<fieldset class="space-y-3 rounded border border-line p-4">
			<legend class="form-label px-1">Repeat</legend>
			<Field for="recurrenceFreq" label="Frequency">
				<Select
					id="recurrenceFreq"
					name="recurrenceFreq"
					options={FREQ_OPTIONS}
					value={form.recurrenceFreq}
				/>
			</Field>
			<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
				<Field for="recurrenceCount" label="Occurrence count">
					<TextInput
						type="number"
						min={1}
						id="recurrenceCount"
						name="recurrenceCount"
						value={form.recurrenceCount}
					/>
				</Field>
				<Field for="recurrenceUntil" label="Or until">
					<TextInput
						type="date"
						id="recurrenceUntil"
						name="recurrenceUntil"
						value={form.recurrenceUntil}
					/>
				</Field>
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
					<Button type="submit" variant="primary">
						{mode === "edit" ? "Save changes" : "Create task"}
					</Button>
					<LinkButton href={backHref}>Cancel</LinkButton>
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
					<h2 class="mb-2 font-semibold text-danger text-sm">Danger zone</h2>
					<Button type="submit" variant="danger">
						Delete task
					</Button>
				</form>
			</Card>
		)}
	</div>
);
