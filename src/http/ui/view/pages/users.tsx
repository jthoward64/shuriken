import type { VNode } from "preact";
import type { SharePanelData } from "#src/http/ui/helpers/share-panel.ts";
import { Button, LinkButton } from "../components/button.tsx";
import { CopyField } from "../components/copy.tsx";
import {
	Badge,
	Card,
	type Column,
	EmptyState,
	Table,
} from "../components/display.tsx";
import { Checkbox, Field, TextInput } from "../components/form/form.tsx";
import { Select } from "../components/form/select.tsx";
import { IconPlus } from "../components/icons.tsx";
import { Breadcrumb, PageHeader } from "../components/page-header.tsx";

import { SharePanel } from "./share-panel.tsx";

// ---------------------------------------------------------------------------
// User management pages: list, create, edit. Admin-scoped (reached from the
// Admin menu). The edit page also hosts the ACL panel, DAV client-setup URLs,
// password reset, collections, and group memberships.
// ---------------------------------------------------------------------------

// --- List ------------------------------------------------------------------

export interface UserListRow {
	readonly id: string;
	readonly displayName: string;
	readonly slug: string;
	readonly email: string;
	readonly canEdit: boolean;
}

export interface UsersListPageProps {
	readonly users: ReadonlyArray<UserListRow>;
	readonly canCreateUser: boolean;
	readonly sharePanel: SharePanelData | undefined;
}

const USER_COLUMNS: ReadonlyArray<Column<UserListRow>> = [
	{ header: "Name", cell: (u) => u.displayName },
	{ header: "Username", cell: (u) => <span class="font-mono">{u.slug}</span> },
	{ header: "Email", cell: (u) => u.email },
	{
		header: "",
		align: "right",
		shrink: true,
		cell: (u) =>
			u.canEdit && (
				<a href={`/ui/users/${u.id}`} class="link">
					Edit
				</a>
			),
	},
];

export const UsersListPage = ({
	users,
	canCreateUser,
	sharePanel,
}: UsersListPageProps): VNode => (
	<div class="space-y-6">
		<PageHeader
			title="Users"
			actions={
				canCreateUser && (
					<LinkButton href="/ui/users/new" variant="primary" size="sm">
						<IconPlus class="size-4" />
						New user
					</LinkButton>
				)
			}
		/>

		<Table
			columns={USER_COLUMNS}
			rows={users}
			getKey={(u) => u.id}
			empty={<EmptyState title="No users found." />}
		/>

		<SharePanel data={sharePanel} />
	</div>
);

// --- New -------------------------------------------------------------------

export interface UserNewPageProps {
	readonly showPasswordForm: boolean;
}

export const UserNewPage = ({ showPasswordForm }: UserNewPageProps): VNode => (
	<div class="mx-auto max-w-2xl space-y-6">
		<div>
			<Breadcrumb
				items={[{ label: "Users", href: "/ui/users" }, { label: "New user" }]}
			/>
			<PageHeader title="New user" />
		</div>

		<Card>
			<form
				method="POST"
				action="/ui/api/users/create"
				hx-post="/ui/api/users/create"
				hx-target="body"
				hx-swap="outerHTML"
				class="space-y-4"
			>
				<Field
					for="slug"
					label="Username"
					required
					hint="Lowercase letters, digits, and hyphens only."
				>
					<TextInput
						id="slug"
						name="slug"
						required
						pattern="[a-z0-9-]+"
						placeholder="e.g. jane-doe"
					/>
				</Field>
				<Field for="displayName" label="Display name">
					<TextInput id="displayName" name="displayName" />
				</Field>
				<Field for="email" label="Email" required>
					<TextInput type="email" id="email" name="email" required />
				</Field>
				{showPasswordForm ? (
					<Field for="password" label="Password" required>
						<TextInput
							type="password"
							id="password"
							name="password"
							autocomplete="new-password"
						/>
					</Field>
				) : null}
				<div class="flex gap-3 pt-2">
					<Button type="submit" variant="primary">
						Create user
					</Button>
					<LinkButton href="/ui/users">Cancel</LinkButton>
				</div>
			</form>
		</Card>
	</div>
);

// --- Edit ------------------------------------------------------------------

export interface UserEditCollection {
	readonly id: string;
	readonly displayName: string;
	readonly collectionType: string;
}

export interface UserEditGroup {
	readonly id: string;
	readonly label: string;
	readonly isMember: boolean;
	readonly canManageMembers: boolean;
	readonly autoAssignedBy: string | null;
}

export interface UserRoleOption {
	readonly value: string;
	readonly selected: boolean;
}

export interface UserEditPageProps {
	readonly userId: string;
	readonly principalId: string;
	readonly title: string;
	readonly displayName: string;
	readonly email: string;
	readonly slug: string;
	readonly canEditSlug: boolean;
	readonly canDelete: boolean;
	readonly showPasswordForm: boolean;
	readonly collections: ReadonlyArray<UserEditCollection>;
	readonly principalUrl: string;
	readonly caldavUrl: string;
	readonly carddavUrl: string;
	readonly sharePanel: SharePanelData | undefined;
	readonly canEditRole: boolean;
	readonly roleOptions: ReadonlyArray<UserRoleOption>;
	readonly userRole: string;
	readonly groups: ReadonlyArray<UserEditGroup>;
}

const USER_COLLECTION_COLUMNS: ReadonlyArray<Column<UserEditCollection>> = [
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

export const UserEditPage = (props: UserEditPageProps): VNode => {
	const base = `/ui/api/users/${props.principalId}`;
	return (
		<div class="mx-auto max-w-2xl space-y-6">
			<div>
				<Breadcrumb
					items={[
						{ label: "Users", href: "/ui/users" },
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
								hx-confirm="Delete this user? This cannot be undone."
								data-confirm="Delete this user? This cannot be undone."
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

			<Card title="Profile">
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
					<Field for="email" label="Email">
						<TextInput
							type="email"
							id="email"
							name="email"
							value={props.email}
						/>
					</Field>
					{props.canEditSlug ? (
						<Field for="slug" label="Username (slug)">
							<TextInput id="slug" name="slug" value={props.slug} />
						</Field>
					) : null}
					{props.canEditRole ? (
						<Field
							for="role"
							label="Role"
							hint="Only super-admins see this control."
						>
							<Select
								id="role"
								name="role"
								options={props.roleOptions.map((r) => ({
									value: r.value,
									label: r.value,
								}))}
								value={props.roleOptions.find((r) => r.selected)?.value}
							/>
						</Field>
					) : (
						<div class="form-group">
							<span class="form-label">Role</span>
							<p class="text-fg text-sm">
								<span class="font-mono">{props.userRole}</span>
							</p>
						</div>
					)}
					<Button type="submit" variant="primary">
						Save changes
					</Button>
				</form>
			</Card>

			<Card title="DAV client setup">
				<div class="space-y-3">
					<p class="form-hint">
						Use these URLs when configuring a CalDAV or CardDAV client.
					</p>
					<CopyField label="Principal URL" value={props.principalUrl} />
					<CopyField label="CalDAV" value={props.caldavUrl} />
					<CopyField label="CardDAV" value={props.carddavUrl} />
				</div>
			</Card>

			{props.showPasswordForm ? (
				<Card title="Change password">
					<form
						method="POST"
						action={`${base}/set-password`}
						hx-post={`${base}/set-password`}
						hx-target="body"
						hx-swap="outerHTML"
						class="space-y-4"
					>
						<Field for="newPassword" label="New password">
							<TextInput
								type="password"
								id="newPassword"
								name="newPassword"
								autocomplete="new-password"
							/>
						</Field>
						<Button type="submit" variant="primary">
							Update password
						</Button>
					</form>
				</Card>
			) : null}

			<Card
				title="Collections"
				actions={
					<LinkButton
						href={`/ui/users/${props.principalId}/collections/new`}
						size="sm"
					>
						Add collection
					</LinkButton>
				}
			>
				<Table
					columns={USER_COLLECTION_COLUMNS}
					rows={props.collections}
					getKey={(c) => c.id}
					empty={<EmptyState title="No collections yet." />}
				/>
			</Card>

			<SharePanel data={props.sharePanel} />

			{props.groups.length > 0 && (
				<Card title="Group memberships">
					<div class="space-y-3">
						<p class="text-muted text-sm">
							Check the groups this user should belong to, then save each group
							individually.
						</p>
						{props.groups.map((g) =>
							g.canManageMembers ? (
								<div
									key={g.id}
									class="border-line border-b pb-3 last:border-0 last:pb-0"
								>
									<p class="mb-2 flex items-center gap-2 font-medium text-fg text-sm">
										{g.label}
										{g.autoAssignedBy ? (
											<Badge>Auto-assigned ({g.autoAssignedBy})</Badge>
										) : null}
									</p>
									<form
										method="POST"
										action={`/ui/api/groups/${g.id}/members`}
										hx-post={`/ui/api/groups/${g.id}/members`}
										hx-target="body"
										hx-swap="outerHTML"
										class="inline-flex items-center gap-3"
									>
										<input type="hidden" name="userId" value={props.userId} />
										<Checkbox
											id={`member-${g.id}`}
											label="Member"
											name="members"
											value={props.userId}
											checked={g.isMember}
										/>
										<Button type="submit" size="sm">
											Save
										</Button>
									</form>
								</div>
							) : (
								<div key={g.id} class="flex items-center gap-2 text-fg text-sm">
									<span
										class={
											g.isMember
												? "inline-block size-3 rounded-full bg-success"
												: "inline-block size-3 rounded-full bg-surface-2"
										}
									/>
									{g.label}
									{g.isMember ? (
										<span class="text-muted text-xs">(member)</span>
									) : null}
									{g.autoAssignedBy ? (
										<Badge>Auto-assigned ({g.autoAssignedBy})</Badge>
									) : null}
								</div>
							),
						)}
					</div>
				</Card>
			)}
		</div>
	);
};
