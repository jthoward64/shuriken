import type { VNode } from "preact";
import { type Column, EmptyState, Table } from "../components/display.tsx";
import { PageHeader } from "../components/page-header.tsx";

// ---------------------------------------------------------------------------
// Trash — soft-deleted collections and instances, with restore / purge.
//
// Deliberately simpler than the contacts/calendar list pages: no sidebar, no
// bulk toolbar, just two tables. Restore and "Delete forever" are plain POST
// forms (no-JS friendly); the destructive purge action gets a `data-confirm`
// prompt (see src/http/ui/static/ui.js for the submit-time confirm handler).
// ---------------------------------------------------------------------------

export interface TrashCollectionRow {
	readonly id: string;
	readonly displayName: string;
	readonly collectionType: string;
	readonly deletedAt: string;
}

export interface TrashInstanceRow {
	readonly id: string;
	readonly slug: string;
	readonly collectionName: string;
	readonly deletedAt: string;
}

export interface TrashPageProps {
	readonly collections: ReadonlyArray<TrashCollectionRow>;
	readonly instances: ReadonlyArray<TrashInstanceRow>;
}

const RestoreForm = ({ action }: { action: string }): VNode => (
	<form method="POST" action={action} class="inline">
		<button type="submit" class="link mr-3">
			Restore
		</button>
	</form>
);

const PurgeForm = ({
	action,
	confirm,
}: {
	action: string;
	confirm: string;
}): VNode => (
	<form method="POST" action={action} data-confirm={confirm} class="inline">
		<button type="submit" class="link text-danger">
			Delete forever
		</button>
	</form>
);

const COLLECTION_COLUMNS: ReadonlyArray<Column<TrashCollectionRow>> = [
	{ header: "Name", cell: (c) => c.displayName },
	{
		header: "Type",
		cell: (c) => <span class="text-muted">{c.collectionType}</span>,
	},
	{
		header: "Deleted",
		cell: (c) => <span class="text-muted">{c.deletedAt}</span>,
	},
	{
		header: "",
		align: "right",
		shrink: true,
		cell: (c) => (
			<div class="whitespace-nowrap">
				<RestoreForm action={`/ui/api/trash/collections/${c.id}/restore`} />
				<PurgeForm
					action={`/ui/api/trash/collections/${c.id}/purge`}
					confirm={`Permanently delete "${c.displayName}" and everything in it? This cannot be undone.`}
				/>
			</div>
		),
	},
];

const INSTANCE_COLUMNS: ReadonlyArray<Column<TrashInstanceRow>> = [
	{
		header: "Item",
		cell: (i) => <span class="font-mono text-xs">{i.slug}</span>,
	},
	{
		header: "From",
		cell: (i) => <span class="text-muted">{i.collectionName}</span>,
	},
	{
		header: "Deleted",
		cell: (i) => <span class="text-muted">{i.deletedAt}</span>,
	},
	{
		header: "",
		align: "right",
		shrink: true,
		cell: (i) => (
			<div class="whitespace-nowrap">
				<RestoreForm action={`/ui/api/trash/instances/${i.id}/restore`} />
				<PurgeForm
					action={`/ui/api/trash/instances/${i.id}/purge`}
					confirm="Permanently delete this item? This cannot be undone."
				/>
			</div>
		),
	},
];

export const TrashPage = ({
	collections,
	instances,
}: TrashPageProps): VNode => (
	<div class="space-y-6">
		<PageHeader
			title="Trash"
			subtitle="Deleted calendars, address books, events, and contacts. Restore them or delete them forever."
		/>
		<div class="space-y-3">
			<h2 class="text-sm font-semibold text-fg">
				Calendars &amp; address books
			</h2>
			<Table
				columns={COLLECTION_COLUMNS}
				rows={collections}
				getKey={(c) => c.id}
				empty={<EmptyState title="No deleted calendars or address books." />}
			/>
		</div>
		<div class="space-y-3">
			<h2 class="text-sm font-semibold text-fg">Events &amp; contacts</h2>
			<Table
				columns={INSTANCE_COLUMNS}
				rows={instances}
				getKey={(i) => i.id}
				empty={<EmptyState title="No deleted events or contacts." />}
			/>
		</div>
	</div>
);
