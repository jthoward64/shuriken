import type { VNode } from "preact";
import type { SharePanelData } from "#src/http/ui/helpers/share-panel.ts";
import type {
	EventFormData,
	RecurrenceFreq,
} from "#src/services/cal-edit/types.ts";
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

import { SharePanel } from "../share-panel.tsx";

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
			<Field for={id("summary")} label="Title" required>
				<TextInput
					required
					autofocus={autofocus}
					id={id("summary")}
					name="summary"
					value={form.summary}
				/>
			</Field>

			<Checkbox
				id={id("allDay")}
				label="All-day event"
				name="allDay"
				checked={form.allDay}
			/>

			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<Field for={id("start")} label="Start" required>
					<TextInput
						required
						id={id("start")}
						name="start"
						value={form.start}
						placeholder="YYYY-MM-DDTHH:mm or YYYY-MM-DD"
					/>
				</Field>
				<Field for={id("end")} label="End">
					<TextInput
						id={id("end")}
						name="end"
						value={form.end}
						placeholder="YYYY-MM-DDTHH:mm or YYYY-MM-DD"
					/>
				</Field>
			</div>

			<Field for={id("location")} label="Location">
				<TextInput id={id("location")} name="location" value={form.location} />
			</Field>

			<Field for={id("description")} label="Description">
				<Textarea
					id={id("description")}
					name="description"
					value={form.description}
				/>
			</Field>

			<Field for={id("categoriesCsv")} label="Categories (comma-separated)">
				<TextInput
					id={id("categoriesCsv")}
					name="categoriesCsv"
					value={form.categoriesCsv}
				/>
			</Field>

			<fieldset class="space-y-3 rounded border border-line p-4">
				<legend class="form-label px-1">Attendees</legend>
				<Field
					for={id("attendeesCsv")}
					label="Email addresses (one per line or comma-separated)"
				>
					<Textarea
						id={id("attendeesCsv")}
						name="attendeesCsv"
						placeholder="alice@example.com&#10;bob@example.org"
						value={form.attendees.join("\n")}
					/>
				</Field>
				<Field
					for={id("organizer")}
					label="Organizer (optional override)"
					hint="Non-local attendees receive an iMIP invite when the event is saved or cancelled."
				>
					<TextInput
						type="email"
						id={id("organizer")}
						name="organizer"
						value={form.organizer}
					/>
				</Field>
			</fieldset>

			<fieldset class="space-y-3 rounded border border-line p-4">
				<legend class="form-label px-1">Repeat</legend>
				<Field for={id("recurrenceFreq")} label="Frequency">
					<Select
						id={id("recurrenceFreq")}
						name="recurrenceFreq"
						options={FREQ_OPTIONS}
						value={form.recurrenceFreq}
					/>
				</Field>
				<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
					<Field for={id("recurrenceCount")} label="Occurrence count">
						<TextInput
							type="number"
							min={1}
							id={id("recurrenceCount")}
							name="recurrenceCount"
							value={form.recurrenceCount}
						/>
					</Field>
					<Field for={id("recurrenceUntil")} label="Or until">
						<TextInput
							type="date"
							id={id("recurrenceUntil")}
							name="recurrenceUntil"
							value={form.recurrenceUntil}
						/>
					</Field>
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
	/** Undefined in "new" mode (nothing to share until the event exists). */
	readonly sharePanel?: SharePanelData;
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
	sharePanel,
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
					<Button type="submit" variant="primary">
						{mode === "edit" ? "Save changes" : "Create event"}
					</Button>
					<LinkButton href={backHref}>Cancel</LinkButton>
				</div>
			</form>
		</Card>

		{mode === "edit" && sharePanel && <SharePanel data={sharePanel} />}

		{mode === "edit" && deleteAction && (
			<Card>
				<form
					method="POST"
					action={deleteAction}
					data-confirm="Delete this event?"
				>
					<h2 class="mb-2 font-semibold text-danger text-sm">Danger zone</h2>
					<Button type="submit" variant="danger">
						Delete event
					</Button>
				</form>
			</Card>
		)}
	</div>
);
