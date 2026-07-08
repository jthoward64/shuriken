import type { VNode } from "preact";
import type {
	EventFormData,
	RecurrenceFreq,
} from "#src/services/cal-edit/types.ts";
import { Breadcrumb, Card, PageHeader } from "../../ui.tsx";

// ---------------------------------------------------------------------------
// Event create/edit form.
//
// `EventFormBody` is the shared field set (title, times, location, …). It is
// reused verbatim by the standalone edit page (`EventFormPage` below), the
// New-event popover on the calendar page, and the Edit-event popover fragment.
// Because several instances can coexist in one document (new + edit popovers),
// every `id`/`for` is namespaced with `idPrefix`; `name` attributes stay bare
// so the server parses them identically regardless of instance.
// ---------------------------------------------------------------------------

const FREQ_OPTIONS: ReadonlyArray<{ value: RecurrenceFreq; label: string }> = [
	{ value: "", label: "None" },
	{ value: "DAILY", label: "Daily" },
	{ value: "WEEKLY", label: "Weekly" },
	{ value: "MONTHLY", label: "Monthly" },
	{ value: "YEARLY", label: "Yearly" },
];

export interface EventFormBodyProps {
	readonly form: EventFormData;
	/** Namespace for field ids so multiple instances coexist (e.g. "new-"). */
	readonly idPrefix?: string;
	/** Focus the title on render (popovers focus their first field on show). */
	readonly autofocus?: boolean;
}

export const EventFormBody = ({
	form,
	idPrefix = "",
	autofocus = false,
}: EventFormBodyProps): VNode => {
	const id = (name: string) => `${idPrefix}${name}`;
	return (
		<div class="space-y-5">
			<div class="form-group">
				<label for={id("summary")} class="form-label">
					Title <span class="text-danger">*</span>
				</label>
				<input
					required
					autofocus={autofocus}
					type="text"
					id={id("summary")}
					name="summary"
					value={form.summary}
					class="form-input"
				/>
			</div>

			<div class="flex items-center gap-2">
				{form.allDay ? (
					<input
						id={id("allDay")}
						type="checkbox"
						name="allDay"
						checked
						class="rounded"
					/>
				) : (
					<input
						id={id("allDay")}
						type="checkbox"
						name="allDay"
						class="rounded"
					/>
				)}
				<label for={id("allDay")} class="text-sm text-fg">
					All-day event
				</label>
			</div>

			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<div class="form-group">
					<label for={id("start")} class="form-label">
						Start <span class="text-danger">*</span>
					</label>
					<input
						required
						type="text"
						id={id("start")}
						name="start"
						value={form.start}
						placeholder="YYYY-MM-DDTHH:mm or YYYY-MM-DD"
						class="form-input"
					/>
				</div>
				<div class="form-group">
					<label for={id("end")} class="form-label">
						End
					</label>
					<input
						type="text"
						id={id("end")}
						name="end"
						value={form.end}
						placeholder="YYYY-MM-DDTHH:mm or YYYY-MM-DD"
						class="form-input"
					/>
				</div>
			</div>

			<div class="form-group">
				<label for={id("location")} class="form-label">
					Location
				</label>
				<input
					type="text"
					id={id("location")}
					name="location"
					value={form.location}
					class="form-input"
				/>
			</div>

			<div class="form-group">
				<label for={id("description")} class="form-label">
					Description
				</label>
				<textarea
					id={id("description")}
					name="description"
					rows={3}
					class="form-textarea"
					value={form.description}
				/>
			</div>

			<div class="form-group">
				<label for={id("categoriesCsv")} class="form-label">
					Categories (comma-separated)
				</label>
				<input
					type="text"
					id={id("categoriesCsv")}
					name="categoriesCsv"
					value={form.categoriesCsv}
					class="form-input"
				/>
			</div>

			<fieldset class="space-y-3 rounded border border-line p-4">
				<legend class="form-label px-1">Attendees</legend>
				<div class="form-group">
					<label for={id("attendeesCsv")} class="form-label">
						Email addresses (one per line or comma-separated)
					</label>
					<textarea
						id={id("attendeesCsv")}
						name="attendeesCsv"
						rows={3}
						placeholder="alice@example.com&#10;bob@example.org"
						class="form-textarea"
						value={form.attendees.join("\n")}
					/>
				</div>
				<div class="form-group">
					<label for={id("organizer")} class="form-label">
						Organizer (optional override)
					</label>
					<input
						type="email"
						id={id("organizer")}
						name="organizer"
						value={form.organizer}
						class="form-input"
					/>
				</div>
				<p class="form-hint">
					Non-local attendees receive an iMIP invite when the event is saved or
					cancelled.
				</p>
			</fieldset>

			<fieldset class="space-y-3 rounded border border-line p-4">
				<legend class="form-label px-1">Repeat</legend>
				<div class="form-group">
					<label for={id("recurrenceFreq")} class="form-label">
						Frequency
					</label>
					<select
						id={id("recurrenceFreq")}
						name="recurrenceFreq"
						class="form-select"
					>
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
						<label for={id("recurrenceCount")} class="form-label">
							Occurrence count
						</label>
						<input
							type="number"
							min={1}
							id={id("recurrenceCount")}
							name="recurrenceCount"
							value={form.recurrenceCount}
							class="form-input"
						/>
					</div>
					<div class="form-group">
						<label for={id("recurrenceUntil")} class="form-label">
							Or until
						</label>
						<input
							type="date"
							id={id("recurrenceUntil")}
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
};

export interface EventFormPageProps {
	readonly mode: "new" | "edit";
	readonly title: string;
	readonly form: EventFormData;
	/** Submit target (create or update). */
	readonly action: string;
	/** Delete target — only used in edit mode. */
	readonly deleteAction?: string;
	readonly backHref: string;
}

// Standalone page — the no-JS path for editing an event (and the fallback if
// the Popover API is unavailable). JS users see the same fields inside a
// popover on the calendar page instead.
export const EventFormPage = ({
	mode,
	title,
	form,
	action,
	deleteAction,
	backHref,
}: EventFormPageProps): VNode => (
	<div class="mx-auto max-w-2xl space-y-6">
		<div>
			<Breadcrumb
				items={[{ label: "Calendar", href: backHref }, { label: title }]}
			/>
			<PageHeader title={title} />
		</div>

		<Card>
			<form method="POST" action={action}>
				<EventFormBody form={form} idPrefix="edit-" />
				<div class="flex flex-wrap gap-3 pt-5">
					<button type="submit" class="btn btn-primary">
						{mode === "edit" ? "Save changes" : "Create event"}
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
					data-confirm="Delete this event?"
				>
					<h2 class="mb-2 text-sm font-semibold text-danger">Danger zone</h2>
					<button type="submit" class="btn btn-danger">
						Delete event
					</button>
				</form>
			</Card>
		)}
	</div>
);
