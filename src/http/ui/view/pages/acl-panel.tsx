import type { VNode } from "preact";
import type { AclPanelData } from "#src/http/ui/helpers/acl-panel.ts";

// ---------------------------------------------------------------------------
// AclPanel — access-control editor shown on user/group/collection/instance
// pages and re-rendered in place by the grant/revoke API handlers. Wrapped in
// `#acl-panel`; its own forms target that id with `outerHTML` so a grant or
// revoke swaps just this section. `data` is `undefined` when the caller lacks
// DAV:write-acl — the panel then renders as an empty (hidden) section so an
// HTMX swap that removes the caller's own access clears it cleanly.
// ---------------------------------------------------------------------------

export const AclPanel = ({
	data,
}: {
	data: AclPanelData | undefined;
}): VNode => {
	if (!data) {
		return <section id="acl-panel" />;
	}

	const grantAction = `/ui/api/acl/${data.resourceType}/${data.resourceId}/grant`;
	const revokeAction = `/ui/api/acl/${data.resourceType}/${data.resourceId}/revoke`;

	return (
		<section id="acl-panel" class="card card-pad space-y-4">
			<h2 class="card-title">Access control</h2>

			{data.aces.length > 0 ? (
				<div class="table-wrap">
					<table class="table">
						<thead>
							<tr>
								<th>Principal</th>
								<th>Privilege</th>
								<th class="w-0" />
							</tr>
						</thead>
						<tbody>
							{data.aces.map((ace) => (
								<tr key={ace.aceId}>
									<td class="text-fg">{ace.principalLabel}</td>
									<td class="text-fg">{ace.privilegeLabel}</td>
									<td class="text-right">
										{ace.protected ? (
											<span
												class="text-xs text-subtle"
												title="System-managed, cannot be removed"
											>
												🔒
											</span>
										) : (
											<form
												method="POST"
												action={revokeAction}
												hx-post={revokeAction}
												hx-target="#acl-panel"
												hx-swap="outerHTML"
												class="inline"
											>
												<input type="hidden" name="aceId" value={ace.aceId} />
												<button
													type="submit"
													class="link text-xs text-danger"
													title="Revoke"
												>
													Revoke
												</button>
											</form>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				<p class="text-sm text-muted">No access entries yet.</p>
			)}

			<div class="border-t border-line pt-4">
				<p class="form-label mb-2">Grant access</p>
				<form
					method="POST"
					action={grantAction}
					hx-post={grantAction}
					hx-target="#acl-panel"
					hx-swap="outerHTML"
					class="flex flex-wrap items-end gap-2"
				>
					<div class="form-group">
						<label for="principalSlug" class="form-label">
							Username or group slug
						</label>
						<input
							type="text"
							id="principalSlug"
							name="principalSlug"
							placeholder="e.g. alice"
							class="form-input"
							required
						/>
					</div>
					<div class="form-group">
						<label for="privilege" class="form-label">
							Privilege
						</label>
						<select id="privilege" name="privilege" class="form-select">
							{data.privilegeOptions.map((o) => (
								<option key={o.value} value={o.value}>
									{o.label}
								</option>
							))}
						</select>
					</div>
					<button type="submit" class="btn btn-primary btn-sm">
						Grant
					</button>
				</form>
			</div>
		</section>
	);
};
