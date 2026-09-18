import type { VNode } from "preact";
import { encodeJson } from "#src/http/ui/helpers/json.ts";
import { Button } from "../../components/button.tsx";
import { Alert, Badge, EmptyState } from "../../components/display.tsx";
import { Field, TextInput } from "../../components/form/form.tsx";
import { Select } from "../../components/form/select.tsx";
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
	<li data-suggestion="">
		<Alert tone="success">
			Fixed ✓
			{contactFn !== "" && (
				<>
					{" "}
					— <strong>{contactFn}</strong>
				</>
			)}
		</Alert>
	</li>
);

export const CleanupError = ({ message }: { message: string }): VNode => (
	<li data-suggestion="">
		<Alert tone="warning">
			{message}{" "}
			<button type="button" data-reload="" class="underline">
				Rescan
			</button>
		</Alert>
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
			<div class="flex flex-wrap items-center gap-2">
				<Badge>{s.title}</Badge>
				<a
					href={`/ui/contacts/${s.instanceId}`}
					class="font-medium text-fg text-sm hover:underline"
				>
					{s.contactFn}
				</a>
			</div>
			<p class="form-hint">{s.description}</p>
			<p class="break-all font-mono text-fg text-sm">
				<span class="text-subtle line-through">{s.current}</span>
				{s.proposed !== "" && (
					<>
						<span class="text-subtle"> → </span>
						<span class="text-fg">{s.proposed}</span>
					</>
				)}
			</p>
		</div>

		<div class="flex shrink-0 items-center gap-2">
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
				<input type="hidden" name="fix" value={encodeJson(s.fix)} />
				<input type="hidden" name="region" value={s.region} />
				<input type="hidden" name="contactFn" value={s.contactFn} />

				{s.needsAreaCode ? (
					<TextInput
						name="areaCode"
						inputmode="numeric"
						placeholder="Area code"
						aria-label="Area code"
						class="w-24"
					/>
				) : null}

				{s.needsLabel ? (
					<Select
						name="newType"
						aria-label="Label"
						class="w-auto"
						options={[
							...s.labelOptions.map((o) => ({ value: o, label: o })),
							{ value: "", label: "(remove label)" },
						]}
					/>
				) : null}

				<Button type="submit" variant="primary" size="sm">
					Fix
				</Button>
			</form>

			<Button data-dismiss-suggestion="" size="sm">
				Ignore
			</Button>
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
						<Field for="cleanup-addressbook" label="Address book">
							<Select
								id="cleanup-addressbook"
								name="addressbook"
								class="w-auto"
								options={addressbooks.map((a) => ({
									value: a.id,
									label: a.displayName,
								}))}
								value={addressbooks.find((a) => a.selected)?.id}
							/>
						</Field>

						<Field for="cleanup-region" label="Region for phone numbers">
							<Select
								id="cleanup-region"
								name="region"
								class="w-auto"
								options={regions.map((r) => ({ value: r.code, label: r.name }))}
								value={regions.find((r) => r.selected)?.code}
							/>
						</Field>

						<Button type="submit" variant="primary" size="sm">
							Rescan
						</Button>
					</form>

					{suggestions.length > 0 ? (
						<>
							<div class="flex items-center justify-between gap-4">
								<p class="text-muted text-sm">
									{suggestionCount} suggestion(s) found.
								</p>
								{suggestions.some(
									(s) => !(s.needsAreaCode || s.needsLabel),
								) && (
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
										<Button type="submit" size="sm">
											Fix all
										</Button>
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
						<EmptyState title="Nothing to clean up here 🎉" />
					)}
				</>
			) : (
				<p class="text-muted text-sm">
					No address book available. Create one from your profile.
				</p>
			)}
		</div>
	);
};
