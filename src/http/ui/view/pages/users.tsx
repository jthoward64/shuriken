import type { VNode } from "preact";
import type { AclPanelData } from "#src/http/ui/helpers/acl-panel.ts";
import { CopyField } from "../copy.tsx";
import { IconPlus } from "../icons.tsx";
import { Breadcrumb, Card, PageHeader } from "../ui.tsx";
import { AclPanel } from "./acl-panel.tsx";

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
	readonly aclPanel: AclPanelData | undefined;
}

export const UsersListPage = ({
	users,
	canCreateUser,
	aclPanel,
}: UsersListPageProps): VNode => (
	<div class="space-y-6">
		<PageHeader
			title="Users"
			actions={
				canCreateUser && (
					<a href="/ui/users/new" class="btn btn-primary btn-sm">
						<IconPlus class="h-4 w-4" />
						New user
					</a>
				)
			}
		/>

		{users.length > 0 ? (
			<div class="table-wrap">
				<table class="table">
					<thead>
						<tr>
							<th>Name</th>
							<th>Username</th>
							<th>Email</th>
							<th class="w-0" />
						</tr>
					</thead>
					<tbody>
						{users.map((u) => (
							<tr key={u.id}>
								<td class="text-fg">{u.displayName}</td>
								<td class="font-mono text-fg">{u.slug}</td>
								<td class="text-fg">{u.email}</td>
								<td class="text-right">
									{u.canEdit && (
										<a href={`/ui/users/${u.id}`} class="link">
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
			<p class="text-sm text-muted">No users found.</p>
		)}

		<AclPanel data={aclPanel} />
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
				<div class="form-group">
					<label for="slug" class="form-label">
						Username <span class="text-danger">*</span>
					</label>
					<input
						type="text"
						id="slug"
						name="slug"
						required
						pattern="[a-z0-9-]+"
						placeholder="e.g. jane-doe"
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
				<div class="form-group">
					<label for="email" class="form-label">
						Email <span class="text-danger">*</span>
					</label>
					<input
						type="email"
						id="email"
						name="email"
						required
						class="form-input"
					/>
				</div>
				{showPasswordForm && (
					<div class="form-group">
						<label for="password" class="form-label">
							Password <span class="text-danger">*</span>
						</label>
						<input
							type="password"
							id="password"
							name="password"
							autocomplete="new-password"
							class="form-input"
						/>
					</div>
				)}
				<div class="flex gap-3 pt-2">
					<button type="submit" class="btn btn-primary">
						Create user
					</button>
					<a href="/ui/users" class="btn btn-secondary">
						Cancel
					</a>
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
	readonly aclPanel: AclPanelData | undefined;
	readonly canEditRole: boolean;
	readonly roleOptions: ReadonlyArray<UserRoleOption>;
	readonly userRole: string;
	readonly groups: ReadonlyArray<UserEditGroup>;
}

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
								<button type="submit" class="btn btn-danger btn-sm">
									Delete
								</button>
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
					<div class="form-group">
						<label for="email" class="form-label">
							Email
						</label>
						<input
							type="email"
							id="email"
							name="email"
							value={props.email}
							class="form-input"
						/>
					</div>
					{props.canEditSlug && (
						<div class="form-group">
							<label for="slug" class="form-label">
								Username (slug)
							</label>
							<input
								type="text"
								id="slug"
								name="slug"
								value={props.slug}
								class="form-input"
							/>
						</div>
					)}
					<div class="form-group">
						<span class="form-label">Role</span>
						{props.canEditRole ? (
							<>
								<select name="role" class="form-select">
									{props.roleOptions.map((r) =>
										r.selected ? (
											<option key={r.value} value={r.value} selected>
												{r.value}
											</option>
										) : (
											<option key={r.value} value={r.value}>
												{r.value}
											</option>
										),
									)}
								</select>
								<p class="form-hint">Only super-admins see this control.</p>
							</>
						) : (
							<p class="text-sm text-fg">
								<span class="font-mono">{props.userRole}</span>
							</p>
						)}
					</div>
					<button type="submit" class="btn btn-primary">
						Save changes
					</button>
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

			{props.showPasswordForm && (
				<Card title="Change password">
					<form
						method="POST"
						action={`${base}/set-password`}
						hx-post={`${base}/set-password`}
						hx-target="body"
						hx-swap="outerHTML"
						class="space-y-4"
					>
						<div class="form-group">
							<label for="newPassword" class="form-label">
								New password
							</label>
							<input
								type="password"
								id="newPassword"
								name="newPassword"
								autocomplete="new-password"
								class="form-input"
							/>
						</div>
						<button type="submit" class="btn btn-primary">
							Update password
						</button>
					</form>
				</Card>
			)}

			<Card
				title="Collections"
				actions={
					<a
						href={`/ui/users/${props.principalId}/collections/new`}
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

			{props.groups.length > 0 && (
				<Card title="Group memberships">
					<div class="space-y-3">
						<p class="text-sm text-muted">
							Check the groups this user should belong to, then save each group
							individually.
						</p>
						{props.groups.map((g) =>
							g.canManageMembers ? (
								<div
									key={g.id}
									class="border-b border-line pb-3 last:border-0 last:pb-0"
								>
									<p class="mb-2 flex items-center gap-2 text-sm font-medium text-fg">
										{g.label}
										{g.autoAssignedBy && (
											<span class="badge">
												Auto-assigned ({g.autoAssignedBy})
											</span>
										)}
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
										<span class="inline-flex items-center gap-2">
											{g.isMember ? (
												<input
													id={`member-${g.id}`}
													type="checkbox"
													name="members"
													value={props.userId}
													checked
													class="rounded"
												/>
											) : (
												<input
													id={`member-${g.id}`}
													type="checkbox"
													name="members"
													value={props.userId}
													class="rounded"
												/>
											)}
											<label
												for={`member-${g.id}`}
												class="cursor-pointer text-sm text-fg"
											>
												Member
											</label>
										</span>
										<button type="submit" class="btn btn-secondary btn-sm">
											Save
										</button>
									</form>
								</div>
							) : (
								<div key={g.id} class="flex items-center gap-2 text-sm text-fg">
									<span
										class={
											g.isMember
												? "inline-block h-3 w-3 rounded-full bg-success"
												: "inline-block h-3 w-3 rounded-full bg-surface-2"
										}
									/>
									{g.label}
									{g.isMember && (
										<span class="text-xs text-muted">(member)</span>
									)}
									{g.autoAssignedBy && (
										<span class="badge">
											Auto-assigned ({g.autoAssignedBy})
										</span>
									)}
								</div>
							),
						)}
					</div>
				</Card>
			)}
		</div>
	);
};
