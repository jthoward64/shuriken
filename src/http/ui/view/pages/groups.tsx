import type { VNode } from "preact";
import type { SharePanelData } from "#src/http/ui/helpers/share-panel.ts";
import { Button, LinkButton } from "../components/button.tsx";
import {
	Badge,
	Card,
	type Column,
	EmptyState,
	Table,
} from "../components/display.tsx";
import { Field, Textarea, TextInput } from "../components/form/form.tsx";
import { IconPlus } from "../components/icons.tsx";
import { Breadcrumb, PageHeader } from "../components/page-header.tsx";

import { SharePanel } from "./share-panel.tsx";

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
	readonly sharePanel: SharePanelData | undefined;
}

const GROUP_COLUMNS: ReadonlyArray<Column<GroupListRow>> = [
	{ header: "Name", cell: (g) => g.displayName },
	{
		header: "Slug",
		cell: (g) => <span class="font-mono text-muted">{g.slug}</span>,
	},
	{
		header: "",
		align: "right",
		shrink: true,
		cell: (g) =>
			g.canEdit && (
				<a href={`/ui/groups/${g.id}`} class="link">
					Edit
				</a>
			),
	},
];

export const GroupsListPage = ({
	groups,
	canCreateGroup,
	sharePanel,
}: GroupsListPageProps): VNode => (
	<div class="space-y-6">
		<PageHeader
			title="Groups"
			actions={
				canCreateGroup && (
					<LinkButton href="/ui/groups/new" variant="primary" size="sm">
						<IconPlus class="h-4 w-4" />
						New group
					</LinkButton>
				)
			}
		/>

		<Table
			columns={GROUP_COLUMNS}
			rows={groups}
			getKey={(g) => g.id}
			empty={<EmptyState title="No groups found." />}
		/>

		<SharePanel data={sharePanel} />
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
				<Field
					for="slug"
					label="Slug"
					required
					hint="Lowercase letters, digits, and hyphens only."
				>
					<TextInput
						id="slug"
						name="slug"
						required
						pattern="[a-z0-9-]+"
						placeholder="e.g. engineering"
					/>
				</Field>
				<Field for="displayName" label="Display name">
					<TextInput id="displayName" name="displayName" />
				</Field>
				<div class="flex gap-3 pt-2">
					<Button type="submit" variant="primary">
						Create group
					</Button>
					<LinkButton href="/ui/groups">Cancel</LinkButton>
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
	readonly sharePanel: SharePanelData | undefined;
	readonly groupAdmins: ReadonlyArray<GroupAdminRow>;
	readonly members: ReadonlyArray<GroupMemberRow>;
	readonly oidcSyncEnabled: boolean;
	readonly oidcGroups: ReadonlyArray<string>;
}

const GROUP_COLLECTION_COLUMNS: ReadonlyArray<Column<GroupEditCollection>> = [
	{
		header: "Name",
		cell: (c) => (
			<a href={`/ui/collections/${c.id}`} class="link">
				{c.displayName}
			</a>
		),
	},
	{
		header: "Type",
		cell: (c) => <span class="text-muted">{c.collectionType}</span>,
	},
];

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
								<Button type="submit" variant="danger" size="sm">
									Delete
								</Button>
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
					<Field for="displayName" label="Display name">
						<TextInput
							id="displayName"
							name="displayName"
							value={props.displayName}
						/>
					</Field>
					<p class="text-sm text-muted">
						<span class="font-medium text-fg">Slug:</span>{" "}
						<span class="font-mono">{props.slug}</span>
					</p>
					<Button type="submit" variant="primary">
						Save changes
					</Button>
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
						<Field
							for="oidcGroups"
							label="IdP group names"
							hint="One per line (or comma-separated). Users whose OIDC groups claim includes any of these are automatically added as members on login; removed automatically when it no longer does."
						>
							<Textarea
								id="oidcGroups"
								name="oidcGroups"
								placeholder="e.g. engineering, on-call"
								value={props.oidcGroups.join("\n")}
							/>
						</Field>
						<Button type="submit" variant="primary">
							Save
						</Button>
					</form>
				</Card>
			)}

			<Card
				title="Collections"
				actions={
					<LinkButton
						href={`/ui/groups/${props.principalId}/collections/new`}
						size="sm"
					>
						Add collection
					</LinkButton>
				}
			>
				<Table
					columns={GROUP_COLLECTION_COLUMNS}
					rows={props.collections}
					getKey={(c) => c.id}
					empty={<EmptyState title="No collections yet." />}
				/>
			</Card>

			<SharePanel data={props.sharePanel} />

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
						<EmptyState title="No group admins yet." />
					)}

					<form
						method="POST"
						action={grantAdmin}
						hx-post={grantAdmin}
						hx-target="body"
						hx-swap="outerHTML"
						class="flex flex-wrap items-end gap-2 border-t border-line pt-4"
					>
						<Field for="adminSlug" label="Add admin (user slug)">
							<TextInput
								id="adminSlug"
								name="principalSlug"
								placeholder="e.g. alice"
								required
							/>
						</Field>
						<input type="hidden" name="privilege" value="DAV:all" />
						<Button type="submit" variant="primary" size="sm">
							Add admin
						</Button>
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
											<Badge>Auto-assigned ({m.autoAssignedBy})</Badge>
										)}
									</span>
									<span class="font-mono text-xs text-muted">{m.slug}</span>
								</li>
							))}
						</ul>
					) : (
						<EmptyState title="No members yet." />
					)}
					<p class="text-xs text-subtle">
						Manage membership from individual user edit pages.
					</p>
				</div>
			</Card>
		</div>
	);
};
