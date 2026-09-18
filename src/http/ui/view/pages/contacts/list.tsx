import type { VNode } from "preact";
import { emptyContactForm } from "#src/services/card-edit/types.ts";
import { Button, LinkButton } from "../../components/button.tsx";
import { Alert, Badge, EmptyState } from "../../components/display.tsx";
import { Checkbox } from "../../components/form/form.tsx";
import { Select } from "../../components/form/select.tsx";
import {
	IconCheck,
	IconChevronDown,
	IconPlus,
	IconSearch,
	IconSpinner,
} from "../../components/icons.tsx";
import { InlineModalPopover } from "../../components/overlay.tsx";
import { PageHeader } from "../../components/page-header.tsx";
import { Pagination } from "../../components/pagination.tsx";

import { EditContactPopoverContainer } from "./edit-dialog.tsx";
import { ContactFormPage } from "./form.tsx";
import { ContactHoverCardContainer } from "./hover-card.tsx";
import {
	CONTACTS_POPOVER_BODY_ID,
	ContactsPopoverContainer,
	NEW_CONTACT_POPOVER_ID,
} from "./popover.tsx";
import { ContactsPaneContainer } from "./preview-pane.tsx";
import { ContactsDrawerToggle, ContactsShell } from "./shell.tsx";

// ---------------------------------------------------------------------------
// Contacts list page.
//
// The address-book sidebar (new-contact button + address-book list, with
// import / export / tools pinned at the bottom) is a popover drawer on mobile
// and a persistent column at xl+ (ContactsShell). Beside it: an integrated
// search header over a simple avatar+name list, and a read-only preview popover
// that opens over the (dimmed, still-visible) list on a row click.
//
// The list + bulk toolbar live inside a `#contact-list` region that re-fetches
// itself on the `contacts:changed` event (fired by the import endpoint via an
// HX-Trigger header). So a successful import updates the list without a full
// navigation, while the import summary lands in `#import-result`. The search
// header and preview popover sit OUTSIDE `#contact-list` so a refresh can't wipe
// them.
//
// Every interaction has a no-JS fallback (native GET/POST forms, native popover
// toggles, target=_blank preview links); HTMX/contacts.js layer on the drawer/
// pane/bulk enhancements. Bulk actions keep the single-form / multiple-
// formaction shape so they work without JavaScript.
// ---------------------------------------------------------------------------

export interface AddressbookOption {
	readonly id: string;
	readonly displayName: string;
	readonly selected: boolean;
	/** Owner's slug when shared with the caller; null when the caller owns it. */
	readonly ownerSlug: string | null;
	/** Whether the caller can create/edit/delete contacts in this address book. */
	readonly writable: boolean;
}

export interface ContactRow {
	readonly instanceId: string;
	readonly fn: string;
	/** Muted secondary line: primary email, else "Title, Org" (may be empty). */
	readonly subtitle: string;
	readonly hasPhoto: boolean;
	/** First character of the display name, for the initials placeholder. */
	readonly initial: string;
}

/** Post-import / post-action notice shown to no-JS users after a redirect. */
export interface ImportNotice {
	readonly imported: number;
	readonly skipped: number;
	readonly merged: number;
	readonly conflicts: number;
}

export interface ContactsListPageProps {
	readonly addressbooks: ReadonlyArray<AddressbookOption>;
	readonly selectedId: string;
	readonly query: string;
	readonly hasAddressbook: boolean;
	/** Whether the caller can create/edit/delete contacts in the selected
	 * address book (always true when it isn't shared). */
	readonly selectedWritable: boolean;
	readonly contacts: ReadonlyArray<ContactRow>;
	readonly page: number;
	readonly totalPages: number;
	readonly notice?: ImportNotice;
}

// The URL the #contact-list region re-fetches itself from on refresh, and the
// URL pagination links point to. Keeps the active address book + search (and
// optionally the current page) so the reloaded table matches the current view.
const listUrl = (selectedId: string, query: string, page = 1): string => {
	const params = new URLSearchParams();
	if (selectedId !== "") {
		params.set("addressbook", selectedId);
	}
	if (query !== "") {
		params.set("q", query);
	}
	if (page > 1) {
		params.set("page", String(page));
	}
	const qs = params.toString();
	return qs === "" ? "/ui/contacts" : `/ui/contacts?${qs}`;
};

// --- Bulk-job progress fragment (swapped into #import-result) ---------------
//
// Rendered immediately after a chunked bulk action (delete/clear-photo/
// download/export/import) starts. static/contacts.js finds this element via
// `data-bulk-job-events`, opens an EventSource against it, and updates the
// bar/count in place as progress frames arrive — see that file for the
// terminal-state handling (download link vs `contacts:changed`).

export interface BulkJobProgressProps {
	readonly jobId: string;
	/** Present only for file-producing jobs (export / bulk-download). */
	readonly resultUrl?: string;
	/** Reload the page on completion instead of firing `contacts:changed` —
	 * used outside the contacts list (e.g. the cleanup suggestion list) where
	 * that event's list-refresh/popover-close handling doesn't apply. */
	readonly reloadOnDone?: boolean;
}

export const BulkJobProgress = ({
	jobId,
	resultUrl,
	reloadOnDone,
}: BulkJobProgressProps): VNode => (
	<div
		id="bulk-job-progress"
		data-bulk-job-events={`/ui/api/contacts/bulk-jobs/${jobId}/events`}
		data-bulk-job-result={resultUrl ?? ""}
		data-bulk-job-reload={reloadOnDone === true ? "" : undefined}
		class="space-y-2 rounded-md border border-subtle bg-surface-2 p-3 text-sm"
	>
		<div class="flex items-center justify-between">
			<span data-bulk-job-label>Working…</span>
			<span data-bulk-job-count class="text-muted">
				0 / 0
			</span>
		</div>
		<progress data-bulk-job-bar class="h-2 w-full" value="0" max="1" />
	</div>
);

// --- Import-result fragment (swapped into #import-result) -------------------

export interface ImportResultProps {
	readonly conflict: boolean;
	readonly conflicts?: ReadonlyArray<string>;
	readonly inserted?: number;
	readonly skipped?: number;
	readonly merged?: number;
	readonly total?: number;
}

export const ImportResult = ({
	conflict,
	conflicts = [],
	inserted = 0,
	skipped = 0,
	merged = 0,
	total = 0,
}: ImportResultProps): VNode =>
	conflict ? (
		<Alert
			tone="warning"
			title={`${conflicts.length} item(s) already exist with these UIDs:`}
			class="space-y-2"
		>
			<ul class="max-h-32 list-inside list-disc overflow-auto font-mono text-muted text-xs">
				{conflicts.map((c) => (
					<li key={c}>{c}</li>
				))}
			</ul>
			<p class="text-muted text-xs">
				Re-select the file with <strong>Skip duplicates</strong> or{" "}
				<strong>Replace duplicates</strong> to proceed.
			</p>
		</Alert>
	) : (
		<Alert tone="success">
			Imported {inserted} new, replaced {merged}, skipped {skipped}.
			{total > 0 && <span class="text-muted"> ({total} total)</span>}
		</Alert>
	);

// --- Sidebar ---------------------------------------------------------------

// Switch address book, preserving the current search query.
const bookHref = (id: string, query: string): string => {
	const params = new URLSearchParams();
	params.set("addressbook", id);
	if (query !== "") {
		params.set("q", query);
	}
	return `/ui/contacts?${params.toString()}`;
};

const AddressbookList = ({
	addressbooks,
	query,
}: {
	addressbooks: ReadonlyArray<AddressbookOption>;
	query: string;
}): VNode => (
	<div class="space-y-2">
		<h2 class="px-1 font-semibold text-subtle text-xs uppercase tracking-wider">
			Address books
		</h2>
		<ul
			class="space-y-0.5"
			data-reorder-list
			data-collection-type="addressbook"
		>
			{addressbooks.map((a) => {
				// Only the caller's own address books can be reordered from here;
				// shared ones are read/write per ACL but not reorderable in this list.
				const mutable = a.ownerSlug === null;
				return (
					<li
						key={a.id}
						data-reorder-item={mutable ? true : undefined}
						data-collection-id={mutable ? a.id : undefined}
						class="flex items-center gap-1"
					>
						<a
							href={bookHref(a.id, query)}
							aria-current={a.selected ? "true" : undefined}
							class={`block min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-sm ${
								a.selected
									? "bg-surface-2 font-semibold text-fg"
									: "text-muted hover:bg-surface-2"
							}`}
						>
							{a.displayName}
						</a>
						{a.ownerSlug !== null && (
							<Badge class="shrink-0" title={`Shared by ${a.ownerSlug}`}>
								{a.ownerSlug}
							</Badge>
						)}
						{mutable && (
							<>
								{/* No-JS reorder fallback; hidden once JS marks the document (the
								    reorder script drags `[data-reorder-item]` rows instead). */}
								<form
									method="POST"
									action={`/ui/api/collections/${a.id}/move/up`}
									data-nojs-only
									class="contents"
								>
									<button
										type="submit"
										aria-label={`Move ${a.displayName} up`}
										class="shrink-0 rounded p-0.5 text-subtle hover:bg-surface-2 hover:text-fg"
									>
										<IconChevronDown class="size-3.5 rotate-180" />
									</button>
								</form>
								<form
									method="POST"
									action={`/ui/api/collections/${a.id}/move/down`}
									data-nojs-only
									class="contents"
								>
									<button
										type="submit"
										aria-label={`Move ${a.displayName} down`}
										class="shrink-0 rounded p-0.5 text-subtle hover:bg-surface-2 hover:text-fg"
									>
										<IconChevronDown class="size-3.5" />
									</button>
								</form>
							</>
						)}
					</li>
				);
			})}
		</ul>
	</div>
);

const DUPLICATE_MODE_OPTIONS = [
	{ value: "error", label: "Conflict" },
	{ value: "skip", label: "Skip" },
	{ value: "merge", label: "Replace" },
];

const ImportForm = ({
	selectedId,
	disabled,
}: {
	selectedId: string;
	disabled: boolean;
}): VNode => (
	<form
		method="POST"
		action={`/ui/api/contacts/${selectedId}/import`}
		enctype="multipart/form-data"
		hx-post={`/ui/api/contacts/${selectedId}/import`}
		hx-encoding="multipart/form-data"
		hx-target="#import-result"
		hx-swap="innerHTML"
		hx-disable="find input[type=file]"
		data-guard=""
		class="space-y-2"
	>
		{/* Button group: a single bordered control split by a divider — the Import
		    button takes ~2/3, the duplicate-mode select ~1/3. */}
		<div
			class={`flex items-stretch overflow-hidden rounded-md border border-line-strong bg-surface text-sm ${
				disabled ? "pointer-events-none opacity-50" : ""
			}`}
		>
			<label
				class="flex basis-2/3 cursor-pointer items-center justify-center gap-2 px-3 py-2 font-medium text-fg hover:bg-surface-2"
				title={disabled ? "Read-only address book" : undefined}
			>
				Import .vcf
				<input
					type="file"
					name="file"
					accept=".vcf,text/vcard"
					disabled={disabled}
					class="hidden"
					data-autosubmit=""
				/>
			</label>
			<div
				class="w-px shrink-0 self-stretch bg-line-strong"
				aria-hidden="true"
			/>
			<Select
				name="mode"
				disabled={disabled}
				options={DUPLICATE_MODE_OPTIONS}
				class="basis-1/3 border-0 bg-transparent p-2 text-xs focus:outline-none focus-visible:bg-surface-2 focus-visible:ring-0 focus-visible:ring-offset-0"
				aria-label="How to handle duplicate contacts"
				title="How to handle duplicate contacts"
			/>
		</div>
		{/* No-JS submit; JS auto-submits on file pick (see static/contacts.js). */}
		<Button
			type="submit"
			disabled={disabled}
			size="sm"
			data-nojs-only
			class="w-full"
		>
			Upload
		</Button>
		<span class="htmx-indicator items-center gap-1 text-muted text-sm">
			<IconSpinner class="size-4 animate-spin" />
			Importing…
		</span>
	</form>
);

const ContactTools = ({
	selectedId,
	writable,
}: {
	selectedId: string;
	writable: boolean;
}): VNode => (
	<div class="space-y-1">
		<LinkButton
			href={`/ui/contacts/export.vcf?addressbook=${selectedId}`}
			hx-post={`/ui/api/contacts/export?addressbook=${selectedId}`}
			hx-target="#import-result"
			hx-swap="innerHTML"
			hx-disable="this"
			data-guard=""
			class="w-full"
		>
			Export .vcf
		</LinkButton>
		{/* Merge/cleanup write to the address book, so gate them (like the New
		    contact / Import actions) on the caller's actual privileges. */}
		{writable && (
			<>
				{/* Lazy dialogs: with JS, htmx loads the fragment into the popover body
				    and contacts.js opens it (data-popover). Without JS, opens in a new
				    tab instead of navigating this embedded page away. */}
				<a
					href={`/ui/contacts/merge?scope=${selectedId}`}
					target="_blank"
					rel="noopener"
					hx-get={`/ui/contacts/merge?scope=${selectedId}`}
					hx-target={`#${CONTACTS_POPOVER_BODY_ID}`}
					hx-swap="innerHTML"
					data-popover="contacts-popover"
					class="block rounded-md px-2 py-1.5 text-muted text-sm hover:bg-surface-2"
				>
					Find duplicates
				</a>
				<a
					href={`/ui/contacts/cleanup?addressbook=${selectedId}`}
					target="_blank"
					rel="noopener"
					hx-get={`/ui/contacts/cleanup?addressbook=${selectedId}`}
					hx-target={`#${CONTACTS_POPOVER_BODY_ID}`}
					hx-swap="innerHTML"
					data-popover="contacts-popover"
					class="block rounded-md px-2 py-1.5 text-muted text-sm hover:bg-surface-2"
				>
					Clean up
				</a>
			</>
		)}
	</div>
);

// --- Bulk toolbar + table (the refreshable region) -------------------------

const BulkToolbar = ({ writable }: { writable: boolean }): VNode => (
	<div data-bulk-bar class="flex flex-wrap items-center gap-2">
		<span class="mr-1 text-muted text-sm">
			<span data-selected-count>0</span> selected:
		</span>
		<Button
			type="submit"
			size="sm"
			formaction="/ui/api/contacts/bulk-download"
			hx-post="/ui/api/contacts/bulk-download"
			hx-include="closest form"
			hx-target="#import-result"
			hx-swap="innerHTML"
			hx-disable="this"
			data-guard=""
		>
			Download .vcf
		</Button>
		{writable && (
			<>
				<Button
					type="submit"
					size="sm"
					formaction="/ui/api/contacts/bulk-clear-photo"
					hx-post="/ui/api/contacts/bulk-clear-photo"
					hx-include="closest form"
					hx-target="#import-result"
					hx-swap="innerHTML"
					hx-confirm="Remove the profile picture from the selected contacts?"
					hx-disable="this"
					data-guard=""
				>
					Remove picture
				</Button>
				<Button
					type="submit"
					variant="danger"
					size="sm"
					formaction="/ui/api/contacts/bulk-delete"
					hx-post="/ui/api/contacts/bulk-delete"
					hx-include="closest form"
					hx-target="#import-result"
					hx-swap="innerHTML"
					hx-confirm="Delete the selected contacts? This cannot be undone."
					hx-disable="this"
					data-guard=""
				>
					Delete
				</Button>
			</>
		)}
		{/* Native reset clears every checkbox in the form — no JS needed; the
		    :has() rule then hides the bar (and contacts.js resets the count). */}
		<Button type="reset" variant="ghost" size="sm" class="ml-auto">
			Clear
		</Button>
	</div>
);

// A single list row with three interaction targets, all flex siblings so their
// click areas never overlap:
//   - the avatar is a <label> wrapping a visually-hidden real checkbox, so
//     clicking it toggles selection (works with no JS; the bulk form posts the
//     checked ids);
//   - the body is a link that opens the preview — with JS contacts.js loads it
//     into the pane / hover card; with no JS it opens the full preview page in a
//     new tab;
//   - the Edit link opens the edit dialog (JS) or the full edit page (no JS).
const ContactListRow = ({ c }: { c: ContactRow }): VNode => (
	<li class="flex items-center gap-3 py-2">
		<label class="contact-avatar-check relative block size-10 shrink-0">
			<input
				type="checkbox"
				name="id"
				value={c.instanceId}
				class="peer sr-only"
				aria-label={`Select ${c.fn}`}
			/>
			{c.hasPhoto ? (
				<img
					src={`/ui/contacts/${c.instanceId}/photo`}
					alt=""
					loading="lazy"
					class="avatar size-10 rounded-full bg-surface-2 object-cover"
				/>
			) : (
				<span
					class="avatar flex size-10 items-center justify-center rounded-full bg-surface-2 font-medium text-muted text-sm"
					aria-hidden="true"
				>
					{c.initial}
				</span>
			)}
			<span class="check-overlay" aria-hidden="true">
				<IconCheck class="size-5" />
			</span>
		</label>
		<a
			href={`/ui/contacts/${c.instanceId}/preview`}
			target="_blank"
			rel="noopener"
			data-open-pane
			data-hover-preview={`/ui/contacts/${c.instanceId}/preview?variant=hover`}
			class="min-w-0 flex-1 rounded-md px-2 py-1 hover:bg-surface-2"
		>
			<span class="block truncate text-fg">{c.fn}</span>
			{c.subtitle !== "" && (
				<span class="block truncate text-muted text-sm">{c.subtitle}</span>
			)}
		</a>
		<a
			href={`/ui/contacts/${c.instanceId}`}
			data-edit-contact
			class="link shrink-0"
		>
			Edit
		</a>
	</li>
);

const ContactListRows = ({
	contacts,
}: {
	contacts: ReadonlyArray<ContactRow>;
}): VNode => (
	// Small horizontal padding so the selected-avatar ring (a 2px box-shadow on
	// the flush-left avatar) isn't clipped by the scroll container's edge.
	<ul class="divide-y divide-line px-1">
		{contacts.map((c) => (
			<ContactListRow key={c.instanceId} c={c} />
		))}
	</ul>
);

// The self-refreshing region. Re-fetches on `contacts:changed` and swaps only
// this subtree (hx-select mirrors the id), so an import updates the table in
// place. Rendered whether or not there are contacts so the trigger persists.
const ContactList = ({
	selectedId,
	query,
	page,
	totalPages,
	contacts,
	writable,
}: {
	selectedId: string;
	query: string;
	page: number;
	totalPages: number;
	contacts: ReadonlyArray<ContactRow>;
	writable: boolean;
}): VNode => (
	<div
		id="contact-list"
		hx-get={listUrl(selectedId, query, page)}
		hx-trigger="contacts:changed from:body"
		hx-target="#contact-list"
		hx-select="#contact-list"
		hx-swap="outerHTML"
		class="contacts-scroll-shadow p-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:[scrollbar-gutter:stable]"
	>
		{contacts.length > 0 ? (
			<form
				method="POST"
				action="/ui/api/contacts/bulk-download"
				class="space-y-3"
			>
				<input type="hidden" name="addressbook" value={selectedId} />
				<div class="ml-1 flex min-h-8 flex-wrap items-center gap-3">
					<Checkbox
						id="contacts-check-all"
						label="Select all"
						data-check-all=""
					/>
					<BulkToolbar writable={writable} />
				</div>
				<ContactListRows contacts={contacts} />
			</form>
		) : (
			<EmptyState
				title={
					query === ""
						? "No contacts here yet."
						: "No contacts match your search."
				}
			/>
		)}
		<Pagination
			label="Contacts pages"
			page={page}
			totalPages={totalPages}
			hrefFor={(n) => listUrl(selectedId, query, n)}
		/>
	</div>
);

// --- Page ------------------------------------------------------------------

export const ContactsListPage = ({
	addressbooks,
	selectedId,
	query,
	hasAddressbook,
	selectedWritable,
	contacts,
	page,
	totalPages,
	notice,
}: ContactsListPageProps): VNode => {
	if (!hasAddressbook) {
		return (
			<div class="space-y-4">
				<PageHeader title="Contacts" />
				<EmptyState
					title="No address book available."
					description="Create one from your profile."
				/>
			</div>
		);
	}

	return (
		<>
			<ContactsShell
				label="Address books"
				drawerTop={
					<>
						{/* Inline dialog: opens natively (no JS needed). */}
						<Button
							variant="primary"
							class="w-full"
							commandfor={selectedWritable ? NEW_CONTACT_POPOVER_ID : undefined}
							command={selectedWritable ? "show-modal" : undefined}
							disabled={!selectedWritable}
							title={selectedWritable ? undefined : "Read-only address book"}
						>
							<IconPlus class="size-4" />
							New contact
						</Button>
						<AddressbookList addressbooks={addressbooks} query={query} />
					</>
				}
				drawerBottom={
					<>
						<ImportForm selectedId={selectedId} disabled={!selectedWritable} />
						<ContactTools selectedId={selectedId} writable={selectedWritable} />
					</>
				}
			>
				{notice && <ImportNoticeBanner notice={notice} />}
				<div id="import-result" class="empty:hidden lg:shrink-0" />

				{/* Integrated search header: the drawer toggle (mobile) sits inline
				    with the search field. Plain GET form so it works with no JS. */}
				<div class="flex items-center gap-2 pb-2 pl-2 lg:shrink-0">
					<ContactsDrawerToggle />
					<form method="GET" action="/ui/contacts" class="relative flex-1">
						<input type="hidden" name="addressbook" value={selectedId} />
						<IconSearch class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
						{/* No submit button: a GET form with a single text input submits
						    on Enter natively, with or without JS. */}
						<input
							type="search"
							name="q"
							value={query}
							placeholder="Search contacts…"
							aria-label="Search contacts"
							class="w-full border-0 bg-transparent py-2 pr-2 pl-9 text-base text-fg placeholder:text-subtle focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
						/>
					</form>
				</div>

				<div class="flex min-w-0 flex-1 flex-col lg:min-h-0">
					<ContactList
						selectedId={selectedId}
						query={query}
						page={page}
						totalPages={totalPages}
						contacts={contacts}
						writable={selectedWritable}
					/>
				</div>
				{/* Modal preview pane (top-layer; opened by contacts.js on row click). */}
				<ContactsPaneContainer />
			</ContactsShell>
			{/* New contact — form rendered inline so the dialog opens with no JS. */}
			<InlineModalPopover id={NEW_CONTACT_POPOVER_ID}>
				<ContactFormPage
					pageTitle="New contact"
					mode="new"
					addressbookId={selectedId}
					form={emptyContactForm}
					action="/ui/api/contacts/create"
					variant="popover"
					popoverId={NEW_CONTACT_POPOVER_ID}
				/>
			</InlineModalPopover>
			{/* Find duplicates / Clean up — lazily loaded into this shared popover. */}
			<ContactsPopoverContainer />
			<EditContactPopoverContainer />
			<ContactHoverCardContainer />
		</>
	);
};

const ImportNoticeBanner = ({ notice }: { notice: ImportNotice }): VNode =>
	notice.conflicts > 0 ? (
		<Alert tone="warning">
			{notice.conflicts} contact(s) already exist with the same UID. Re-import
			with <strong>Skip duplicates</strong> or{" "}
			<strong>Replace duplicates</strong> to proceed.
		</Alert>
	) : (
		<Alert tone="success">
			Imported {notice.imported} new, replaced {notice.merged}, skipped{" "}
			{notice.skipped}.
		</Alert>
	);
