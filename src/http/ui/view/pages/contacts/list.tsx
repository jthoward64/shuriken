import type { VNode } from "preact";
import { emptyContactForm } from "#src/services/card-edit/types.ts";
import { IconChevronDown, IconPlus, IconSpinner } from "../../icons.tsx";
import { buttonClass, InlineModalPopover } from "../../ui.tsx";
import { SidebarShell } from "../sidebar-shell.tsx";
import { EditContactPopoverContainer } from "./edit-dialog.tsx";
import { ContactFormPage } from "./form.tsx";
import { ContactHoverCardContainer } from "./hover-card.tsx";
import {
	CONTACTS_POPOVER_BODY_ID,
	ContactsPopoverContainer,
	NEW_CONTACT_POPOVER_ID,
} from "./popover.tsx";

// ---------------------------------------------------------------------------
// Contacts list page.
//
// A left sidebar (new-contact button + an address-book list, with import /
// export / tools pinned at the bottom) sits beside the main content: a search
// bar over the contact table.
//
// The contact table + bulk toolbar live inside a `#contact-list` region that
// re-fetches itself on the `contacts:changed` event (fired by the import
// endpoint via an HX-Trigger header). So a successful import updates the table
// without a full navigation, while the import summary lands in `#import-result`.
//
// Bulk actions keep the original single-form / multiple-formaction shape so they
// work without JavaScript; HTMX attributes are layered on as an override (with
// the progress bar + navigate guard from static/contacts.js via [data-guard]).
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
	readonly email: string;
	readonly tel: string;
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
		class="rounded-md border border-subtle bg-surface-2 p-3 text-sm space-y-2"
	>
		<div class="flex items-center justify-between">
			<span data-bulk-job-label>Working…</span>
			<span data-bulk-job-count class="text-muted">
				0 / 0
			</span>
		</div>
		<progress data-bulk-job-bar class="w-full h-2" value="0" max="1" />
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
		<div class="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm space-y-2">
			<p class="font-medium text-warning">
				{conflicts.length} item(s) already exist with these UIDs:
			</p>
			<ul class="list-disc list-inside text-xs max-h-32 overflow-auto font-mono text-muted">
				{conflicts.map((c) => (
					<li key={c}>{c}</li>
				))}
			</ul>
			<p class="text-xs text-muted">
				Re-select the file with <strong>Skip duplicates</strong> or{" "}
				<strong>Replace duplicates</strong> to proceed.
			</p>
		</div>
	) : (
		<div class="rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success">
			Imported {inserted} new, replaced {merged}, skipped {skipped}.
			{total > 0 && <span class="text-muted"> ({total} total)</span>}
		</div>
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
		<h2 class="px-1 text-xs font-semibold uppercase tracking-wider text-subtle">
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
							<span class="badge shrink-0" title={`Shared by ${a.ownerSlug}`}>
								{a.ownerSlug}
							</span>
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
										<IconChevronDown class="h-3.5 w-3.5 rotate-180" />
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
										<IconChevronDown class="h-3.5 w-3.5" />
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
		<div class="flex items-center gap-2">
			<label
				class={buttonClass(
					"secondary",
					`flex-1 cursor-pointer ${disabled ? "pointer-events-none opacity-50" : ""}`,
				)}
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
			<select
				name="mode"
				class="form-select w-auto text-xs"
				aria-label="How to handle duplicate contacts"
				title="How to handle duplicate contacts"
			>
				<option value="error">Conflict</option>
				<option value="skip">Skip</option>
				<option value="merge">Replace</option>
			</select>
		</div>
		{/* No-JS submit; JS auto-submits on file pick (see static/contacts.js). */}
		<button
			type="submit"
			disabled={disabled}
			data-nojs-only
			class={buttonClass("secondary", "btn-sm w-full")}
		>
			Upload
		</button>
		<span class="htmx-indicator items-center gap-1 text-sm text-muted">
			<IconSpinner class="h-4 w-4 animate-spin" />
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
		<a
			href={`/ui/contacts/export.vcf?addressbook=${selectedId}`}
			hx-post={`/ui/api/contacts/export?addressbook=${selectedId}`}
			hx-target="#import-result"
			hx-swap="innerHTML"
			hx-disable="this"
			data-guard=""
			class={buttonClass("secondary", "w-full")}
		>
			Export .vcf
		</a>
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
					class="block rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-2"
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
					class="block rounded-md px-2 py-1.5 text-sm text-muted hover:bg-surface-2"
				>
					Clean up
				</a>
			</>
		)}
	</div>
);

// --- Bulk toolbar + table (the refreshable region) -------------------------

const BulkToolbar = ({ writable }: { writable: boolean }): VNode => (
	<div class="flex flex-wrap items-center gap-2 card card-pad !py-2">
		<span class="text-sm text-muted mr-1">With selected:</span>
		<button
			type="submit"
			formaction="/ui/api/contacts/bulk-download"
			hx-post="/ui/api/contacts/bulk-download"
			hx-include="closest form"
			hx-target="#import-result"
			hx-swap="innerHTML"
			hx-disable="this"
			data-guard=""
			class="btn btn-secondary btn-sm"
		>
			Download .vcf
		</button>
		{writable && (
			<>
				<button
					type="submit"
					formaction="/ui/api/contacts/bulk-clear-photo"
					hx-post="/ui/api/contacts/bulk-clear-photo"
					hx-include="closest form"
					hx-target="#import-result"
					hx-swap="innerHTML"
					hx-confirm="Remove the profile picture from the selected contacts?"
					hx-disable="this"
					data-guard=""
					class="btn btn-secondary btn-sm"
				>
					Remove picture
				</button>
				<button
					type="submit"
					formaction="/ui/api/contacts/bulk-delete"
					hx-post="/ui/api/contacts/bulk-delete"
					hx-include="closest form"
					hx-target="#import-result"
					hx-swap="innerHTML"
					hx-confirm="Delete the selected contacts? This cannot be undone."
					hx-disable="this"
					data-guard=""
					class="btn btn-danger btn-sm"
				>
					Delete
				</button>
			</>
		)}
	</div>
);

const ContactTable = ({
	contacts,
}: {
	contacts: ReadonlyArray<ContactRow>;
}): VNode => (
	<div class="table-wrap">
		<table class="table">
			<thead>
				<tr>
					<th class="w-8">
						<input
							type="checkbox"
							aria-label="Select all contacts"
							data-check-all=""
						/>
					</th>
					<th class="w-12 sr-only">Photo</th>
					<th>Name</th>
					<th>Email</th>
					<th>Phone</th>
					<th />
				</tr>
			</thead>
			<tbody>
				{contacts.map((c) => (
					<tr key={c.instanceId}>
						<td>
							<input
								type="checkbox"
								name="id"
								value={c.instanceId}
								aria-label={`Select ${c.fn}`}
							/>
						</td>
						<td>
							{c.hasPhoto ? (
								<img
									src={`/ui/contacts/${c.instanceId}/photo`}
									alt=""
									loading="lazy"
									class="w-9 h-9 rounded-full object-cover bg-surface-2"
								/>
							) : (
								<span
									class="w-9 h-9 rounded-full bg-surface-2 text-muted flex items-center justify-center text-sm font-medium"
									aria-hidden="true"
								>
									{c.initial}
								</span>
							)}
						</td>
						<td class="text-fg">{c.fn}</td>
						<td class="text-muted">{c.email}</td>
						<td class="text-muted">{c.tel}</td>
						<td class="text-right">
							{/* With JS, hover or click loads the read-only preview into the
							    hover card (contacts.js) instead of navigating; its Edit
							    button opens the real edit dialog. Without JS, the link opens
							    the full edit page in a new tab. */}
							<a
								href={`/ui/contacts/${c.instanceId}`}
								target="_blank"
								rel="noopener"
								data-hover-preview={`/ui/contacts/${c.instanceId}/preview`}
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
	query,
	page,
	totalPages,
}: {
	selectedId: string;
	query: string;
	page: number;
	totalPages: number;
}): VNode | null => {
	if (totalPages <= 1) {
		return null;
	}
	return (
		<nav
			aria-label="Contacts pages"
			class="flex items-center justify-between gap-2 pt-1 text-sm text-muted"
		>
			{page > 1 ? (
				<a
					href={listUrl(selectedId, query, page - 1)}
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
					href={listUrl(selectedId, query, page + 1)}
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
		class="lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
	>
		{contacts.length > 0 ? (
			<form
				method="POST"
				action="/ui/api/contacts/bulk-download"
				class="space-y-3"
			>
				<input type="hidden" name="addressbook" value={selectedId} />
				<BulkToolbar writable={writable} />
				<ContactTable contacts={contacts} />
			</form>
		) : (
			<p class="text-sm text-muted">
				{query === ""
					? "No contacts here yet."
					: "No contacts match your search."}
			</p>
		)}
		<Pagination
			selectedId={selectedId}
			query={query}
			page={page}
			totalPages={totalPages}
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
				<h1 class="page-title">Contacts</h1>
				<p class="text-sm text-muted">
					No address book available. Create one from your profile.
				</p>
			</div>
		);
	}

	return (
		<>
			<SidebarShell
				label="Address books"
				top={
					<>
						{/* Inline dialog: opens natively (no JS needed). */}
						<button
							type="button"
							commandfor={selectedWritable ? NEW_CONTACT_POPOVER_ID : undefined}
							command={selectedWritable ? "show-modal" : undefined}
							disabled={!selectedWritable}
							title={selectedWritable ? undefined : "Read-only address book"}
							class={buttonClass("primary", "w-full")}
						>
							<IconPlus class="h-4 w-4" />
							New contact
						</button>
						<AddressbookList addressbooks={addressbooks} query={query} />
					</>
				}
				bottom={
					<>
						<ImportForm selectedId={selectedId} disabled={!selectedWritable} />
						<ContactTools selectedId={selectedId} writable={selectedWritable} />
					</>
				}
			>
				{notice && <ImportNoticeBanner notice={notice} />}
				<div id="import-result" class="empty:hidden lg:shrink-0" />

				<form
					method="GET"
					action="/ui/contacts"
					class="card card-pad !py-3 flex flex-wrap items-center gap-3 lg:shrink-0"
				>
					<input type="hidden" name="addressbook" value={selectedId} />
					<label class="text-sm text-muted flex items-center gap-2 flex-1 min-w-[12rem]">
						Search
						<input
							type="search"
							name="q"
							value={query}
							placeholder="Name…"
							class="form-input"
						/>
					</label>
					<button type="submit" class="btn btn-secondary btn-sm">
						Filter
					</button>
				</form>

				<ContactList
					selectedId={selectedId}
					query={query}
					page={page}
					totalPages={totalPages}
					contacts={contacts}
					writable={selectedWritable}
				/>
			</SidebarShell>
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
		<div
			role="alert"
			class="rounded-md border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning"
		>
			{notice.conflicts} contact(s) already exist with the same UID. Re-import
			with <strong>Skip duplicates</strong> or{" "}
			<strong>Replace duplicates</strong> to proceed.
		</div>
	) : (
		<div
			role="alert"
			class="rounded-md border border-success/40 bg-success/10 px-4 py-3 text-sm text-success"
		>
			Imported {notice.imported} new, replaced {notice.merged}, skipped{" "}
			{notice.skipped}.
		</div>
	);
