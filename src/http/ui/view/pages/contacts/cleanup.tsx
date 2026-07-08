import type { VNode } from "preact";
import { CONTACTS_POPOVER_BODY_ID, ContactsPopoverHeader } from "./popover.tsx";
import { ContactsCrumb } from "./shared.tsx";

// ---------------------------------------------------------------------------
// Clean-up page. Scans the selected address book and lists each data-quality
// problem as a Fix / Ignore suggestion. Applying a fix POSTs to the fix
// endpoint and swaps the `[data-suggestion]` item for a done/error fragment.
// ---------------------------------------------------------------------------

export interface CleanupSuggestionData {
	readonly instanceId: string;
	readonly contactFn: string;
	readonly title: string;
	readonly description: string;
	readonly current: string;
	readonly proposed: string;
	/** The fix intent, serialised to JSON in the form (see cleanup-fix.tsx). */
	readonly fix: unknown;
	readonly needsAreaCode: boolean;
	readonly needsLabel: boolean;
	readonly labelOptions: ReadonlyArray<string>;
	readonly region: string;
}

export interface RegionOption {
	readonly code: string;
	readonly name: string;
	readonly selected: boolean;
}

export interface AddressbookOption {
	readonly id: string;
	readonly displayName: string;
	readonly selected: boolean;
}

export interface ContactsCleanupPageProps {
	readonly hasAddressbook: boolean;
	readonly addressbooks: ReadonlyArray<AddressbookOption>;
	readonly regions: ReadonlyArray<RegionOption>;
	readonly suggestions: ReadonlyArray<CleanupSuggestionData>;
	readonly suggestionCount: number;
	/** "popover" renders a fragment for the contacts modal popover (header
	 * instead of breadcrumb; the rescan form re-swaps the popover body). */
	readonly variant?: "page" | "popover";
}

// --- Result fragments (swapped into the [data-suggestion] item) -------------

export const CleanupDone = ({ contactFn }: { contactFn: string }): VNode => (
	<li
		data-suggestion=""
		class="rounded-md border border-success/40 bg-success/10 p-4 text-sm text-success"
	>
		Fixed ✓
		{contactFn !== "" && (
			<>
				{" "}
				— <strong>{contactFn}</strong>
			</>
		)}
	</li>
);

export const CleanupError = ({ message }: { message: string }): VNode => (
	<li
		data-suggestion=""
		class="rounded-md border border-warning/40 bg-warning/10 p-4 text-sm text-warning"
	>
		{message}{" "}
		<button type="button" data-reload="" class="underline">
			Rescan
		</button>
	</li>
);

// --- One scan suggestion ----------------------------------------------------

export const CleanupSuggestion = ({
	s,
}: {
	s: CleanupSuggestionData;
}): VNode => (
	<li
		data-suggestion=""
		class="card card-pad flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
	>
		<div class="min-w-0 space-y-1">
			<div class="flex items-center gap-2 flex-wrap">
				<span class="badge">{s.title}</span>
				<a
					href={`/ui/contacts/${s.instanceId}`}
					class="text-sm font-medium text-fg hover:underline"
				>
					{s.contactFn}
				</a>
			</div>
			<p class="form-hint">{s.description}</p>
			<p class="text-sm text-fg font-mono break-all">
				<span class="line-through text-subtle">{s.current}</span>
				{s.proposed !== "" && (
					<>
						<span class="text-subtle"> → </span>
						<span class="text-fg">{s.proposed}</span>
					</>
				)}
			</p>
		</div>

		<div class="flex items-center gap-2 shrink-0">
			<form
				method="POST"
				action="/ui/api/contacts/cleanup/fix"
				hx-post="/ui/api/contacts/cleanup/fix"
				hx-target="closest [data-suggestion]"
				hx-swap="outerHTML"
				hx-disable="find button[type=submit]"
				data-guard=""
				class="flex items-center gap-2"
			>
				<input type="hidden" name="instanceId" value={s.instanceId} />
				<input type="hidden" name="fix" value={JSON.stringify(s.fix)} />
				<input type="hidden" name="region" value={s.region} />
				<input type="hidden" name="contactFn" value={s.contactFn} />

				{s.needsAreaCode && (
					<input
						type="text"
						name="areaCode"
						inputmode="numeric"
						placeholder="Area code"
						class="form-input w-24"
					/>
				)}

				{s.needsLabel && (
					<select name="newType" class="form-select w-auto">
						{s.labelOptions.map((o) => (
							<option key={o} value={o}>
								{o}
							</option>
						))}
						<option value="">(remove label)</option>
					</select>
				)}

				<button type="submit" class="btn btn-primary btn-sm">
					Fix
				</button>
			</form>

			<button
				type="button"
				data-dismiss-suggestion=""
				class="btn btn-secondary btn-sm"
			>
				Ignore
			</button>
		</div>
	</li>
);

// --- Page ------------------------------------------------------------------

export const ContactsCleanupPage = ({
	hasAddressbook,
	addressbooks,
	regions,
	suggestions,
	suggestionCount,
	variant = "page",
}: ContactsCleanupPageProps): VNode => {
	const popover = variant === "popover";
	// In the popover the rescan form re-swaps the popover body over HTMX; on the
	// page it navigates normally.
	const rescanProps = popover
		? {
				"hx-get": "/ui/contacts/cleanup",
				"hx-target": `#${CONTACTS_POPOVER_BODY_ID}`,
				"hx-swap": "innerHTML",
			}
		: {};
	return (
		<div class="space-y-4">
			{popover ? (
				<ContactsPopoverHeader title="Clean up" />
			) : (
				<ContactsCrumb title="Clean up contacts" />
			)}

			{hasAddressbook ? (
				<>
					<form
						method="GET"
						action="/ui/contacts/cleanup"
						{...rescanProps}
						class="card card-pad flex flex-wrap items-end gap-4"
					>
						<label class="form-group block">
							<span class="form-label">Address book</span>
							<select name="addressbook" class="form-select mt-1 w-auto">
								{addressbooks.map((a) => (
									<option key={a.id} value={a.id} selected={a.selected}>
										{a.displayName}
									</option>
								))}
							</select>
						</label>

						<label class="form-group block">
							<span class="form-label">Region for phone numbers</span>
							<select name="region" class="form-select mt-1 w-auto">
								{regions.map((r) => (
									<option key={r.code} value={r.code} selected={r.selected}>
										{r.name}
									</option>
								))}
							</select>
						</label>

						<button type="submit" class="btn btn-primary btn-sm">
							Rescan
						</button>
					</form>

					{suggestions.length > 0 ? (
						<>
							<div class="flex items-center justify-between gap-4">
								<p class="text-sm text-muted">
									{suggestionCount} suggestion(s) found.
								</p>
								{suggestions.some((s) => !s.needsAreaCode && !s.needsLabel) && (
									<form
										method="POST"
										action="/ui/api/contacts/cleanup/fix-all"
										hx-post="/ui/api/contacts/cleanup/fix-all"
										hx-target="#cleanup-suggestions"
										hx-swap="innerHTML"
										hx-disable="find button[type=submit]"
										data-guard=""
									>
										<input
											type="hidden"
											name="addressbook"
											value={addressbooks.find((a) => a.selected)?.id ?? ""}
										/>
										<input
											type="hidden"
											name="region"
											value={regions.find((r) => r.selected)?.code ?? ""}
										/>
										<button type="submit" class="btn btn-secondary btn-sm">
											Fix all
										</button>
									</form>
								)}
							</div>
							<div id="cleanup-suggestions">
								<ul class="space-y-2">
									{suggestions.map((s) => (
										<CleanupSuggestion key={s.instanceId + s.current} s={s} />
									))}
								</ul>
							</div>
						</>
					) : (
						<p class="text-sm text-muted">Nothing to clean up here 🎉</p>
					)}
				</>
			) : (
				<p class="text-sm text-muted">
					No address book available. Create one from your profile.
				</p>
			)}
		</div>
	);
};
