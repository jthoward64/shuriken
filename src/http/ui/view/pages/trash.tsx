import type { VNode } from "preact";
import { PageHeader } from "../ui.tsx";

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

const CollectionsSection = ({
	collections,
}: {
	collections: ReadonlyArray<TrashCollectionRow>;
}): VNode => (
	<div class="space-y-3">
		<h2 class="text-sm font-semibold text-fg">Calendars &amp; address books</h2>
		{collections.length > 0 ? (
			<div class="table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th>Name</th>
							<th>Type</th>
							<th>Deleted</th>
							<th class="w-0" />
						</tr>
					</thead>
					<tbody>
						{collections.map((c) => (
							<tr key={c.id}>
								<td class="text-fg">{c.displayName}</td>
								<td class="text-muted">{c.collectionType}</td>
								<td class="text-muted">{c.deletedAt}</td>
								<td class="text-right whitespace-nowrap">
									<RestoreForm
										action={`/ui/api/trash/collections/${c.id}/restore`}
									/>
									<PurgeForm
										action={`/ui/api/trash/collections/${c.id}/purge`}
										confirm={`Permanently delete "${c.displayName}" and everything in it? This cannot be undone.`}
									/>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		) : (
			<p class="text-sm text-muted">No deleted calendars or address books.</p>
		)}
	</div>
);

const InstancesSection = ({
	instances,
}: {
	instances: ReadonlyArray<TrashInstanceRow>;
}): VNode => (
	<div class="space-y-3">
		<h2 class="text-sm font-semibold text-fg">Events &amp; contacts</h2>
		{instances.length > 0 ? (
			<div class="table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th>Item</th>
							<th>From</th>
							<th>Deleted</th>
							<th class="w-0" />
						</tr>
					</thead>
					<tbody>
						{instances.map((i) => (
							<tr key={i.id}>
								<td class="font-mono text-xs text-fg">{i.slug}</td>
								<td class="text-muted">{i.collectionName}</td>
								<td class="text-muted">{i.deletedAt}</td>
								<td class="text-right whitespace-nowrap">
									<RestoreForm
										action={`/ui/api/trash/instances/${i.id}/restore`}
									/>
									<PurgeForm
										action={`/ui/api/trash/instances/${i.id}/purge`}
										confirm="Permanently delete this item? This cannot be undone."
									/>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		) : (
			<p class="text-sm text-muted">No deleted events or contacts.</p>
		)}
	</div>
);

export const TrashPage = ({
	collections,
	instances,
}: TrashPageProps): VNode => (
	<div class="space-y-6">
		<PageHeader
			title="Trash"
			subtitle="Deleted calendars, address books, events, and contacts. Restore them or delete them forever."
		/>
		<CollectionsSection collections={collections} />
		<InstancesSection instances={instances} />
	</div>
);
