import type { ComponentChildren, VNode } from "preact";
import {
	Button,
	buttonClass,
	LinkButton,
} from "#src/http/ui/view/components/button.tsx";
import {
	DateField,
	DateRangeField,
} from "#src/http/ui/view/components/controls/date-picker.tsx";
import { RichTextField } from "#src/http/ui/view/components/controls/rich-text.tsx";
import { SearchPicker } from "#src/http/ui/view/components/controls/search-picker.tsx";
import { TagCombobox } from "#src/http/ui/view/components/controls/tag-combobox.tsx";
import { TagPicker } from "#src/http/ui/view/components/controls/tag-picker.tsx";
import {
	Alert,
	Badge,
	Card,
	type Column,
	EmptyState,
	Table,
} from "#src/http/ui/view/components/display.tsx";
import {
	Checkbox,
	Field,
	FileInput,
	Textarea,
	TextInput,
} from "#src/http/ui/view/components/form/form.tsx";
import { Select } from "#src/http/ui/view/components/form/select.tsx";
import {
	Menu,
	MenuItem,
	MenuLabel,
	Modal,
	ModalTrigger,
} from "#src/http/ui/view/components/overlay.tsx";
import { PageHeader } from "#src/http/ui/view/components/page-header.tsx";
import { Pagination } from "#src/http/ui/view/components/pagination.tsx";

// ---------------------------------------------------------------------------
// Component gallery - every shared UI component rendered live, so look, dark
// mode, keyboard behaviour and the no-JS fallbacks can be checked in one place
// without hunting through feature pages.
//
// The four scripted controls sit inside a real form that posts to the echo
// endpoint, so what the server actually receives from each one is visible
// rather than assumed.
// ---------------------------------------------------------------------------

const ECHO_ENDPOINT = "/ui/api/dev/components/echo";
const SEARCH_ENDPOINT = "/ui/api/dev/components/search";

const TAG_SUGGESTIONS = [
	"Work",
	"Personal",
	"Planning",
	"Travel",
	"Finance",
	"Health",
];

const DEMO_RICH_HTML =
	"<p>Agenda for the <strong>quarterly review</strong>:</p><ul><li>Budget</li><li>Headcount</li></ul>";
const DEMO_RICH_TEXT =
	"Agenda for the quarterly review:\n\n * Budget\n * Headcount";

const Section = ({
	title,
	note,
	children,
}: {
	title: string;
	note?: string;
	children: ComponentChildren;
}): VNode => (
	<Card title={title}>
		{note !== undefined && <p class="mb-4 text-sm text-muted">{note}</p>}
		<div class="space-y-4">{children}</div>
	</Card>
);

const Row = ({ children }: { children: ComponentChildren }): VNode => (
	<div class="flex flex-wrap items-center gap-2">{children}</div>
);

interface DemoRow {
	readonly id: string;
	readonly name: string;
	readonly kind: string;
	readonly state: "active" | "paused";
}

const DEMO_ROWS: ReadonlyArray<DemoRow> = [
	{ id: "1", name: "Work", kind: "Calendar", state: "active" },
	{ id: "2", name: "Personal", kind: "Calendar", state: "paused" },
	{ id: "3", name: "Colleagues", kind: "Address book", state: "active" },
];

const DEMO_COLUMNS: ReadonlyArray<Column<DemoRow>> = [
	{ header: "Name", cell: (r) => r.name },
	{ header: "Kind", cell: (r) => r.kind },
	{
		header: "State",
		cell: (r) => (
			<Badge tone={r.state === "active" ? "success" : "neutral"}>
				{r.state}
			</Badge>
		),
	},
	{
		header: "",
		shrink: true,
		align: "right",
		cell: () => (
			<a href="#top" class="link text-xs">
				Edit
			</a>
		),
	},
];

const PRIORITY_OPTIONS = [
	{ value: "", label: "No priority" },
	{
		value: "high",
		label: "High",
		icon: "🔴",
		description: "Needs attention today",
	},
	{
		value: "normal",
		label: "Normal",
		icon: "🟡",
		description: "Scheduled work",
	},
	{
		value: "low",
		label: "Low",
		icon: "🟢",
		description: "Whenever there is time",
	},
];

export const ComponentGalleryPage = (): VNode => (
	<div class="space-y-6" id="top">
		<PageHeader
			title="Component gallery"
			subtitle="Every shared UI component, rendered live."
		/>

		<Card title="How to read this page">
			<div class="space-y-2 text-sm text-muted">
				<p>
					Every control here is progressively enhanced. Disable JavaScript and
					reload: the tag picker becomes a comma-separated text field, the date
					fields become native date inputs, the search picker becomes a plain
					text input, and the editor becomes a textarea. All of them still
					submit the same field names.
				</p>
				<p>
					Dropdowns use{" "}
					<code class="rounded bg-surface-2 px-1">appearance: base-select</code>
					. In Chrome and Edge they render the styled picker below, with icons
					and description lines. Firefox and Safari fall back to the native
					dropdown showing the labels only - both are correct.
				</p>
			</div>
		</Card>

		<Section
			title="Buttons"
			note="Variants and sizes. LinkButton is the same styling on an anchor, for navigation rather than action."
		>
			<Row>
				<Button variant="primary">Primary</Button>
				<Button variant="secondary">Secondary</Button>
				<Button variant="danger">Danger</Button>
				<Button variant="ghost">Ghost</Button>
				<Button variant="primary" disabled>
					Disabled
				</Button>
			</Row>
			<Row>
				<Button variant="primary" size="sm">
					Small
				</Button>
				<Button variant="primary">Medium</Button>
				<Button variant="primary" size="lg">
					Large
				</Button>
				<LinkButton href="#top" variant="secondary">
					LinkButton
				</LinkButton>
			</Row>
		</Section>

		<Section
			title="Form controls"
			note="Field owns the label, hint and error; the control inside stays a plain element that passes native attributes through."
		>
			<div class="grid gap-4 md:grid-cols-2">
				<Field
					for="demo-text"
					label="Display name"
					hint="Shown to other users."
				>
					<TextInput
						id="demo-text"
						name="demoText"
						placeholder="Ada Lovelace"
					/>
				</Field>
				<Field
					for="demo-email"
					label="Email"
					required
					error="That address is already in use."
				>
					<TextInput
						id="demo-email"
						name="demoEmail"
						type="email"
						value="ada@example.com"
						invalid
					/>
				</Field>
				<Field
					for="demo-select"
					label="Priority"
					hint="Rich options render in the styled picker where supported."
				>
					<Select
						id="demo-select"
						name="demoSelect"
						value="normal"
						options={PRIORITY_OPTIONS}
					/>
				</Field>
				<Field for="demo-file" label="Import file" hint="iCalendar or vCard.">
					<FileInput id="demo-file" name="demoFile" accept=".ics,.vcf" />
				</Field>
			</div>
			<Field for="demo-textarea" label="Notes">
				<Textarea id="demo-textarea" name="demoNotes" rows={3} />
			</Field>
			<div class="space-y-2">
				<Checkbox
					id="demo-check-1"
					name="demoCheck1"
					label="Send invitations by email"
					hint="Attendees outside this server receive an iMIP message."
					checked
				/>
				<Checkbox
					id="demo-check-2"
					name="demoCheck2"
					label="Include free/busy information"
				/>
			</div>
		</Section>

		<Section
			title="Display"
			note="Table takes its columns as data, so headers and cells cannot drift apart, and renders the empty state itself when there are no rows."
		>
			<Row>
				<Badge>Neutral</Badge>
				<Badge tone="brand">Brand</Badge>
				<Badge tone="success">Success</Badge>
				<Badge tone="warning">Warning</Badge>
				<Badge tone="danger">Danger</Badge>
			</Row>
			<Table columns={DEMO_COLUMNS} rows={DEMO_ROWS} getKey={(r) => r.id} />
			<Table
				columns={DEMO_COLUMNS}
				rows={[]}
				getKey={(r) => r.id}
				empty={
					<EmptyState
						title="No collections yet"
						description="Create a calendar or address book to get started."
						action={<Button variant="primary">New collection</Button>}
					/>
				}
			/>
		</Section>

		<Section
			title="Callouts"
			note="Alert reports the outcome of an action or a caveat about one. The warning and danger tones are announced by assistive tech; the others stay silent."
		>
			<Alert>Nothing has changed since the last sync.</Alert>
			<Alert tone="success">Imported 12 new, replaced 3, skipped 0.</Alert>
			<Alert tone="warning" title="4 item(s) already exist with these UIDs:">
				Re-select the file with <strong>Skip duplicates</strong> to proceed.
			</Alert>
			<Alert tone="danger" title="Please correct the following:">
				<ul class="list-inside list-disc space-y-0.5">
					<li>Start must be before End.</li>
				</ul>
			</Alert>
		</Section>

		<Section
			title="Pagination"
			note="Link-based, so it works with the page's own query string and needs no JS. The ends of the range render as disabled steps."
		>
			<Pagination
				label="Demo pages"
				page={1}
				totalPages={3}
				hrefFor={(n) => `?page=${n}`}
			/>
			<Pagination
				label="Demo pages"
				page={2}
				totalPages={3}
				hrefFor={(n) => `?page=${n}`}
			/>
			<Pagination
				label="Demo pages"
				page={3}
				totalPages={3}
				hrefFor={(n) => `?page=${n}`}
			/>
		</Section>

		<Section
			title="Overlays"
			note="Both are JavaScript-free: the modal is a native dialog opened by a command button, the menu is a native details element."
		>
			<Row>
				<ModalTrigger modalId="demo-modal" class={buttonClass("secondary")}>
					Open modal
				</ModalTrigger>
				<Menu label="Actions" triggerClass={buttonClass("secondary")}>
					<MenuLabel>Collection</MenuLabel>
					<MenuItem href="#top">Edit</MenuItem>
					<MenuItem href="#top">Duplicate</MenuItem>
					<MenuItem href="#top">Export</MenuItem>
				</Menu>
			</Row>
			<Modal
				id="demo-modal"
				title="Delete this calendar?"
				footer={
					<>
						<button
							type="button"
							command="close"
							commandfor="demo-modal"
							class={buttonClass("secondary")}
						>
							Cancel
						</button>
						<Button variant="danger">Delete</Button>
					</>
				}
			>
				<p class="text-sm text-muted">
					Everything in it moves to the trash and can be restored for 30 days.
				</p>
			</Modal>
		</Section>

		<form
			hx-post={ECHO_ENDPOINT}
			hx-target="#demo-echo"
			hx-swap="outerHTML"
			method="POST"
			action={ECHO_ENDPOINT}
			class="space-y-6"
		>
			<Section
				title="Tag combobox"
				note="One bounded field: tokens sit inside it with the cursor after them, and the dropdown offers the predefined options. Enter or a comma commits what you typed, Backspace on an empty entry removes the last token. Submits one comma-separated field."
			>
				<Field
					for="demo-tags"
					label="Categories"
					hint="Pick from the list or type your own."
				>
					<TagCombobox
						id="demo-tags"
						name="categoriesCsv"
						value={["Work", "Planning"]}
						suggestions={TAG_SUGGESTIONS}
						allowCustom
					/>
				</Field>
			</Section>

			<Section
				title="Tag picker (alternative)"
				note="The same CSV contract built on a real <select> instead of a token field, for cases that want the native dropdown. Kept as an alternative, not the default."
			>
				<Field
					for="demo-tags-alt"
					label="Categories"
					hint="Choose from the dropdown, or type a new tag and press Enter."
				>
					<TagPicker
						id="demo-tags-alt"
						name="altCategoriesCsv"
						value={["Travel"]}
						suggestions={TAG_SUGGESTIONS}
						allowCustom
					/>
				</Field>
			</Section>

			<Section
				title="Date and range pickers"
				note="Calendar popover with JavaScript, native date input without it, validated text input where the date type is unsupported. Date-only pickers close once the selection is complete; the ones with a time stay open so the time can be adjusted, writing through on every change."
			>
				<div class="grid gap-4 md:grid-cols-2">
					<Field for="demo-date" label="Due date">
						<DateField id="demo-date" name="dueDate" />
					</Field>
					<Field for="demo-datetime" label="Starts at">
						<DateField id="demo-datetime" name="startsAt" mode="datetime" />
					</Field>
				</div>
				<DateRangeField
					id="demo-range"
					startName="rangeStart"
					endName="rangeEnd"
				/>
				<DateRangeField
					id="demo-range-dt"
					startName="shiftStart"
					endName="shiftEnd"
					mode="datetime"
					startLabel="Shift starts"
					endLabel="Shift ends"
				/>
			</Section>

			<Section
				title="Search picker"
				note="Incremental lookup against an endpoint. Type at least two characters. Without JavaScript it is a plain text input and the server resolves whatever was typed."
			>
				<Field
					for="demo-search"
					label="Share with"
					hint="Demo data: try 'a', 'an' or 'ro'."
				>
					<SearchPicker
						id="demo-search"
						name="principalSlug"
						endpoint={SEARCH_ENDPOINT}
						placeholder="Name or email"
					/>
				</Field>
			</Section>

			<Section
				title="Rich text editor"
				note="Posts both the markup and a plain-text rendering. Without JavaScript it is a textarea and only the plain field is sent."
			>
				<Field for="demo-rich" label="Description">
					<RichTextField
						id="demo-rich"
						name="description"
						valueHtml={DEMO_RICH_HTML}
						valueText={DEMO_RICH_TEXT}
					/>
				</Field>
			</Section>

			<div class="flex justify-end gap-2">
				<Button type="reset">Reset</Button>
				<Button type="submit" variant="primary">
					Submit and show what the server received
				</Button>
			</div>
		</form>

		<div id="demo-echo" />
	</div>
);
