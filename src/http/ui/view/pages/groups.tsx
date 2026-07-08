import type { VNode } from "preact";
import type { AclPanelData } from "#src/http/ui/helpers/acl-panel.ts";
import { IconPlus } from "../icons.tsx";
import { Breadcrumb, Card, PageHeader } from "../ui.tsx";
import { AclPanel } from "./acl-panel.tsx";

// ---------------------------------------------------------------------------
// Group management pages: list, create, edit. Admin-scoped. The edit page
// hosts the ACL panel, collections, group admins (DAV:all delegates), and a
// read-only members list.
// ---------------------------------------------------------------------------

// --- List ------------------------------------------------------------------

export interface GroupListRow {
	readonly id: string;
	readonly displayName: string;
	readonly slug: string;
	readonly canEdit: boolean;
}

export interface GroupsListPageProps {
	readonly groups: ReadonlyArray<GroupListRow>;
	readonly canCreateGroup: boolean;
	readonly aclPanel: AclPanelData | undefined;
}

export const GroupsListPage = ({
	groups,
	canCreateGroup,
	aclPanel,
}: GroupsListPageProps): VNode => (
	<div class="space-y-6">
		<PageHeader
			title="Groups"
			actions={
				canCreateGroup && (
					<a href="/ui/groups/new" class="btn btn-primary btn-sm">
						<IconPlus class="h-4 w-4" />
						New group
					</a>
				)
			}
		/>

		{groups.length > 0 ? (
			<div class="table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th>Name</th>
							<th>Slug</th>
							<th class="w-0" />
						</tr>
					</thead>
					<tbody>
						{groups.map((g) => (
							<tr key={g.id}>
								<td class="text-fg">{g.displayName}</td>
								<td class="font-mono text-muted">{g.slug}</td>
								<td class="text-right">
									{g.canEdit && (
										<a href={`/ui/groups/${g.id}`} class="link">
											Edit
										</a>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		) : (
			<p class="text-sm text-muted">No groups found.</p>
		)}

		<AclPanel data={aclPanel} />
	</div>
);

// --- New -------------------------------------------------------------------

export const GroupNewPage = (): VNode => (
	<div class="mx-auto max-w-2xl space-y-6">
		<div>
			<Breadcrumb
				items={[
					{ label: "Groups", href: "/ui/groups" },
					{ label: "New group" },
				]}
			/>
			<PageHeader title="New group" />
		</div>

		<Card>
			<form
				method="POST"
				action="/ui/api/groups/create"
				hx-post="/ui/api/groups/create"
				hx-target="body"
				hx-swap="outerHTML"
				class="space-y-4"
			>
				<div class="form-group">
					<label for="slug" class="form-label">
						Slug <span class="text-danger">*</span>
					</label>
					<input
						type="text"
						id="slug"
						name="slug"
						required
						pattern="[a-z0-9-]+"
						placeholder="e.g. engineering"
						class="form-input"
					/>
					<p class="form-hint">Lowercase letters, digits, and hyphens only.</p>
				</div>
				<div class="form-group">
					<label for="displayName" class="form-label">
						Display name
					</label>
					<input
						type="text"
						id="displayName"
						name="displayName"
						class="form-input"
					/>
				</div>
				<div class="flex gap-3 pt-2">
					<button type="submit" class="btn btn-primary">
						Create group
					</button>
					<a href="/ui/groups" class="btn btn-secondary">
						Cancel
					</a>
				</div>
			</form>
		</Card>
	</div>
);

// --- Edit ------------------------------------------------------------------

export interface GroupEditCollection {
	readonly id: string;
	readonly displayName: string;
	readonly collectionType: string;
}

export interface GroupAdminRow {
	readonly aceId: string;
	readonly label: string;
}

export interface GroupMemberRow {
	readonly id: string;
	readonly label: string;
	readonly slug: string;
	readonly autoAssignedBy: string | null;
}

export interface GroupEditPageProps {
	readonly principalId: string;
	readonly title: string;
	readonly displayName: string;
	readonly slug: string;
	readonly canDelete: boolean;
	readonly collections: ReadonlyArray<GroupEditCollection>;
	readonly aclPanel: AclPanelData | undefined;
	readonly groupAdmins: ReadonlyArray<GroupAdminRow>;
	readonly members: ReadonlyArray<GroupMemberRow>;
	readonly oidcSyncEnabled: boolean;
	readonly oidcGroups: ReadonlyArray<string>;
}

export const GroupEditPage = (props: GroupEditPageProps): VNode => {
	const base = `/ui/api/groups/${props.principalId}`;
	const grantAdmin = `/ui/api/acl/principal/${props.principalId}/grant`;
	const revokeAdmin = `/ui/api/acl/principal/${props.principalId}/revoke`;
	return (
		<div class="mx-auto max-w-2xl space-y-6">
			<div>
				<Breadcrumb
					items={[
						{ label: "Groups", href: "/ui/groups" },
						{ label: props.title },
					]}
				/>
				<PageHeader
					title={props.title}
					actions={
						props.canDelete && (
							<form
								method="POST"
								action={`${base}/delete`}
								hx-post={`${base}/delete`}
								hx-target="body"
								hx-swap="outerHTML"
								hx-confirm="Delete this group? This cannot be undone."
								data-confirm="Delete this group? This cannot be undone."
								class="inline"
							>
								<button type="submit" class="btn btn-danger btn-sm">
									Delete
								</button>
							</form>
						)
					}
				/>
			</div>

			<Card title="Details">
				<form
					method="POST"
					action={`${base}/update`}
					hx-post={`${base}/update`}
					hx-target="body"
					hx-swap="outerHTML"
					class="space-y-4"
				>
					<div class="form-group">
						<label for="displayName" class="form-label">
							Display name
						</label>
						<input
							type="text"
							id="displayName"
							name="displayName"
							value={props.displayName}
							class="form-input"
						/>
					</div>
					<p class="text-sm text-muted">
						<span class="font-medium text-fg">Slug:</span>{" "}
						<span class="font-mono">{props.slug}</span>
					</p>
					<button type="submit" class="btn btn-primary">
						Save changes
					</button>
				</form>
			</Card>

			{props.oidcSyncEnabled && (
				<Card title="OIDC auto-assign">
					<form
						method="POST"
						action={`${base}/update`}
						hx-post={`${base}/update`}
						hx-target="body"
						hx-swap="outerHTML"
						class="space-y-4"
					>
						<div class="form-group">
							<label for="oidcGroups" class="form-label">
								IdP group names
							</label>
							<textarea
								id="oidcGroups"
								name="oidcGroups"
								rows={3}
								class="form-input"
								placeholder="e.g. engineering, on-call"
							>
								{props.oidcGroups.join("\n")}
							</textarea>
							<p class="form-hint">
								One per line (or comma-separated). Users whose OIDC groups claim
								includes any of these are automatically added as members on
								login; removed automatically when it no longer does.
							</p>
						</div>
						<button type="submit" class="btn btn-primary">
							Save
						</button>
					</form>
				</Card>
			)}

			<Card
				title="Collections"
				actions={
					<a
						href={`/ui/groups/${props.principalId}/collections/new`}
						class="btn btn-secondary btn-sm"
					>
						Add collection
					</a>
				}
			>
				{props.collections.length > 0 ? (
					<div class="table-wrap">
						<table class="table">
							<thead>
								<tr>
									<th>Name</th>
									<th>Type</th>
								</tr>
							</thead>
							<tbody>
								{props.collections.map((c) => (
									<tr key={c.id}>
										<td>
											<a href={`/ui/collections/${c.id}`} class="link">
												{c.displayName}
											</a>
										</td>
										<td class="text-muted">{c.collectionType}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<p class="text-sm text-muted">No collections yet.</p>
				)}
			</Card>

			<AclPanel data={props.aclPanel} />

			<Card title="Group admins">
				<div class="space-y-4">
					<p class="form-hint">
						Users granted DAV:all on this group's principal can manage its
						membership and act on its behalf.
					</p>
					{props.groupAdmins.length > 0 ? (
						<ul class="divide-y divide-line">
							{props.groupAdmins.map((a) => (
								<li
									key={a.aceId}
									class="flex items-center justify-between py-2 text-sm"
								>
									<span class="text-fg">{a.label}</span>
									<form
										method="POST"
										action={revokeAdmin}
										hx-post={revokeAdmin}
										hx-target="body"
										hx-swap="outerHTML"
										class="inline"
									>
										<input type="hidden" name="aceId" value={a.aceId} />
										<button type="submit" class="link text-xs text-danger">
											Remove
										</button>
									</form>
								</li>
							))}
						</ul>
					) : (
						<p class="text-sm text-muted">No group admins yet.</p>
					)}

					<form
						method="POST"
						action={grantAdmin}
						hx-post={grantAdmin}
						hx-target="body"
						hx-swap="outerHTML"
						class="flex flex-wrap items-end gap-2 border-t border-line pt-4"
					>
						<div class="form-group">
							<label for="adminSlug" class="form-label">
								Add admin (user slug)
							</label>
							<input
								type="text"
								id="adminSlug"
								name="principalSlug"
								placeholder="e.g. alice"
								class="form-input"
								required
							/>
						</div>
						<input type="hidden" name="privilege" value="DAV:all" />
						<button type="submit" class="btn btn-primary btn-sm">
							Add admin
						</button>
					</form>
				</div>
			</Card>

			<Card title="Members">
				<div class="space-y-4">
					{props.members.length > 0 ? (
						<ul class="divide-y divide-line">
							{props.members.map((m) => (
								<li
									key={m.id}
									class="flex items-center justify-between py-2 text-sm"
								>
									<span class="flex items-center gap-2 text-fg">
										{m.label}
										{m.autoAssignedBy && (
											<span class="badge">
												Auto-assigned ({m.autoAssignedBy})
											</span>
										)}
									</span>
									<span class="font-mono text-xs text-muted">{m.slug}</span>
								</li>
							))}
						</ul>
					) : (
						<p class="text-sm text-muted">No members yet.</p>
					)}
					<p class="text-xs text-subtle">
						Manage membership from individual user edit pages.
					</p>
				</div>
			</Card>
		</div>
	);
};
