import type { VNode } from "preact";
import { Button } from "../../components/button.tsx";
import {
	Alert,
	type Column,
	EmptyState,
	Table,
} from "../../components/display.tsx";
import { Checkbox, Field } from "../../components/form/form.tsx";
import { Select } from "../../components/form/select.tsx";
import { CONTACTS_POPOVER_BODY_ID, ContactsPopoverHeader } from "./popover.tsx";
import { ContactsCrumb } from "./shared.tsx";

// ---------------------------------------------------------------------------
// Merge-duplicates page. The GET form re-runs detection; each detected group
// gets its own Merge button that POSTs to the merge endpoint and swaps the
// group (`.merge-group`) for the MergeResult confirmation on success.
// ---------------------------------------------------------------------------

export interface MergeMember {
	readonly instanceId: string;
	readonly fn: string;
	readonly email: string;
	readonly tel: string;
	readonly addressbook: string;
}

export interface MergeGroupData {
	/** Comma-separated instance ids that make up the group. */
	readonly ids: string;
	readonly count: number;
	readonly members: ReadonlyArray<MergeMember>;
}

export interface AddressbookOption {
	readonly id: string;
	readonly displayName: string;
	readonly selected: boolean;
}

export interface ContactsMergePageProps {
	readonly scope: string;
	readonly scopeAll: boolean;
	readonly emailChecked: boolean;
	readonly phoneChecked: boolean;
	readonly nameChecked: boolean;
	readonly noCriteria: boolean;
	readonly run: boolean;
	readonly addressbooks: ReadonlyArray<AddressbookOption>;
	readonly groups: ReadonlyArray<MergeGroupData>;
	readonly groupCount: number;
	readonly showAddressbook: boolean;
	readonly hasAddressbook: boolean;
	/** "popover" renders a fragment for the contacts modal popover (header
	 * instead of breadcrumb; the find form re-swaps the popover body). */
	readonly variant?: "page" | "popover";
}

// --- Merge-result fragment (swapped in after a successful merge) ------------

export const MergeResult = ({
	fn,
	mergedCount,
}: {
	fn: string;
	mergedCount: number;
}): VNode => (
	<Alert tone="success" class="merge-group">
		Merged {mergedCount} duplicate(s) into <strong>{fn}</strong>.
	</Alert>
);

// --- One detected duplicate group ------------------------------------------

const memberColumns = (
	showAddressbook: boolean,
): ReadonlyArray<Column<MergeMember>> => [
	{
		header: "Name",
		cell: (m) => (
			<a href={`/ui/contacts/${m.instanceId}`} class="link">
				{m.fn}
			</a>
		),
	},
	{ header: "Email", cell: (m) => <span class="text-muted">{m.email}</span> },
	{ header: "Phone", cell: (m) => <span class="text-muted">{m.tel}</span> },
	...(showAddressbook
		? [
				{
					header: "Address book",
					cell: (m: MergeMember) => (
						<span class="text-muted">{m.addressbook}</span>
					),
				},
			]
		: []),
];

const MergeGroup = ({
	group,
	showAddressbook,
}: {
	group: MergeGroupData;
	showAddressbook: boolean;
}): VNode => (
	<div class="merge-group card card-pad space-y-3">
		<Table
			columns={memberColumns(showAddressbook)}
			rows={group.members}
			getKey={(m) => m.instanceId}
		/>
		<div class="flex items-center justify-between gap-3">
			<p class="form-hint">
				The most complete contact is kept; the rest are merged into it.
			</p>
			<form
				method="POST"
				action="/ui/api/contacts/merge"
				hx-post="/ui/api/contacts/merge"
				hx-target="closest .merge-group"
				hx-swap="outerHTML"
				hx-disable="find button"
				data-guard=""
			>
				<input type="hidden" name="ids" value={group.ids} />
				<Button type="submit" variant="primary" size="sm">
					Merge {group.count}
				</Button>
			</form>
		</div>
	</div>
);

// --- Page ------------------------------------------------------------------

export const ContactsMergePage = ({
	scope,
	scopeAll,
	emailChecked,
	phoneChecked,
	nameChecked,
	noCriteria,
	run,
	addressbooks,
	groups,
	groupCount,
	showAddressbook,
	hasAddressbook,
	variant = "page",
}: ContactsMergePageProps): VNode => {
	const popover = variant === "popover";
	// In the popover the find form re-swaps the popover body over HTMX; on the
	// page it navigates normally.
	const findProps = popover
		? {
				"hx-get": "/ui/contacts/merge",
				"hx-target": `#${CONTACTS_POPOVER_BODY_ID}`,
				"hx-swap": "innerHTML",
			}
		: {};
	return (
		<div class="space-y-4">
			{popover ? (
				<ContactsPopoverHeader title="Find duplicates" />
			) : (
				<ContactsCrumb title="Merge duplicates" />
			)}

			{hasAddressbook ? (
				<>
					<form
						method="GET"
						action="/ui/contacts/merge"
						{...findProps}
						class="card card-pad flex flex-wrap items-end gap-4"
					>
						<input type="hidden" name="run" value="1" />

						<Field for="merge-scope" label="Scope">
							<Select
								id="merge-scope"
								name="scope"
								class="w-auto"
								options={[
									{ value: "all", label: "All my address books" },
									...addressbooks.map((a) => ({
										value: a.id,
										label: a.displayName,
									})),
								]}
								value={scopeAll ? "all" : scope}
							/>
						</Field>

						<fieldset class="text-muted text-sm">
							<legend class="form-label mb-1">
								Match when contacts share any of
							</legend>
							<div class="flex items-center gap-4">
								<Checkbox
									id="merge-by-email"
									label="Email"
									name="email"
									checked={emailChecked}
								/>
								<Checkbox
									id="merge-by-phone"
									label="Phone"
									name="phone"
									checked={phoneChecked}
								/>
								<Checkbox
									id="merge-by-name"
									label="Name"
									name="name"
									checked={nameChecked}
								/>
							</div>
						</fieldset>

						<Button type="submit" variant="primary" size="sm">
							Find duplicates
						</Button>
					</form>

					{noCriteria ? (
						<Alert tone="warning">Select at least one field to match on.</Alert>
					) : run ? (
						groups.length > 0 ? (
							<>
								<p class="text-muted text-sm">
									{groupCount} duplicate group(s) found.
								</p>
								<div class="space-y-4">
									{groups.map((g) => (
										<MergeGroup
											key={g.ids}
											group={g}
											showAddressbook={showAddressbook}
										/>
									))}
								</div>
							</>
						) : (
							<EmptyState title="No duplicates found for the selected criteria." />
						)
					) : null}
				</>
			) : (
				<EmptyState
					title="No address book available."
					description="Create one from your profile."
				/>
			)}
		</div>
	);
};
