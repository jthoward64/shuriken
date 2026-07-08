import type { VNode } from "preact";
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
	<div class="merge-group rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success">
		Merged {mergedCount} duplicate(s) into <strong>{fn}</strong>.
	</div>
);

// --- One detected duplicate group ------------------------------------------

const MergeGroup = ({
	group,
	showAddressbook,
}: {
	group: MergeGroupData;
	showAddressbook: boolean;
}): VNode => (
	<div class="merge-group card card-pad space-y-3">
		<div class="table-wrap">
			<table class="table">
				<thead>
					<tr>
						<th>Name</th>
						<th>Email</th>
						<th>Phone</th>
						{showAddressbook && <th>Address book</th>}
					</tr>
				</thead>
				<tbody>
					{group.members.map((m) => (
						<tr key={m.instanceId}>
							<td class="text-fg">
								<a href={`/ui/contacts/${m.instanceId}`} class="link">
									{m.fn}
								</a>
							</td>
							<td class="text-muted">{m.email}</td>
							<td class="text-muted">{m.tel}</td>
							{showAddressbook && <td class="text-muted">{m.addressbook}</td>}
						</tr>
					))}
				</tbody>
			</table>
		</div>
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
				<button type="submit" class="btn btn-primary btn-sm">
					Merge {group.count}
				</button>
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

						<label class="form-group block">
							<span class="form-label">Scope</span>
							<select name="scope" class="form-select mt-1 w-auto">
								<option value="all" selected={scopeAll}>
									All my address books
								</option>
								{addressbooks.map((a) => (
									<option
										key={a.id}
										value={a.id}
										selected={!scopeAll && a.id === scope}
									>
										{a.displayName}
									</option>
								))}
							</select>
						</label>

						<fieldset class="text-sm text-muted">
							<legend class="form-label mb-1">
								Match when contacts share any of
							</legend>
							<div class="flex items-center gap-4">
								<label class="inline-flex items-center gap-1">
									<input type="checkbox" name="email" checked={emailChecked} />{" "}
									Email
								</label>
								<label class="inline-flex items-center gap-1">
									<input type="checkbox" name="phone" checked={phoneChecked} />{" "}
									Phone
								</label>
								<label class="inline-flex items-center gap-1">
									<input type="checkbox" name="name" checked={nameChecked} />{" "}
									Name
								</label>
							</div>
						</fieldset>

						<button type="submit" class="btn btn-primary btn-sm">
							Find duplicates
						</button>
					</form>

					{noCriteria ? (
						<p class="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
							Select at least one field to match on.
						</p>
					) : run ? (
						groups.length > 0 ? (
							<>
								<p class="text-sm text-muted">
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
							<p class="text-sm text-muted">
								No duplicates found for the selected criteria.
							</p>
						)
					) : null}
				</>
			) : (
				<p class="text-sm text-muted">
					No address book available. Create one from your profile.
				</p>
			)}
		</div>
	);
};
