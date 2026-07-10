import type { VNode } from "preact";
import type { SharePanelData } from "#src/http/ui/helpers/share-panel.ts";

// ---------------------------------------------------------------------------
// SharePanel — access-control editor shown on user/group/collection/instance
// pages and re-rendered in place by the grant/revoke/set-tier/collapse API
// handlers. Wrapped in `#share-panel`; its forms target that id with
// `outerHTML` so any action swaps just this section. `data` is `undefined`
// when the caller lacks DAV:write-acl — the panel then renders as an empty
// (hidden) section so an HTMX swap that removes the caller's own access
// clears it cleanly.
//
// Two views — Basic (friendly tiers: view/edit/manage/free-busy, no raw
// privilege strings) and Advanced (the full per-privilege ACE table +
// free-form grant, the pre-existing AclPanel UI) — are each wrapped in a
// native <details>, which needs no JS to toggle open/closed. `data.
// defaultMode` picks which one starts open: Basic when the current ACL
// state is exactly representable by the tiers, Advanced otherwise. Both
// remain independently reachable (a user can open one, the other, or both)
// rather than a strict either/or toggle — simpler and fully functional
// without JS, matching this codebase's progressive-enhancement convention.
// ---------------------------------------------------------------------------

export const SharePanel = ({
	data,
}: {
	data: SharePanelData | undefined;
}): VNode => {
	if (!data) {
		return <section id="share-panel" />;
	}

	const base = `/ui/api/acl/${data.resourceType}/${data.resourceId}`;
	const grantAction = `${base}/grant`;
	const revokeAction = `${base}/revoke`;
	const setTierAction = `${base}/set-tier`;
	const collapseAction = `${base}/collapse`;

	return (
		<section id="share-panel" class="card card-pad space-y-4">
			<h2 class="card-title">Access control</h2>

			{/* Basic view */}
			<details open={data.defaultMode === "basic"} class="space-y-4">
				<summary class="cursor-pointer text-sm font-medium">Simple</summary>
				<div class="space-y-4 pt-2">
					{!data.representableInBasic && (
						<div class="rounded border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-900 space-y-2">
							<p>
								Some access here uses advanced options (custom privilege
								combinations, deny rules, or group/everyone grants) that Simple
								mode can't show individually. Making a change below will
								simplify that entry to the closest Simple option (View/Edit
								{data.tiers.some((t) => t.tier === "manage") ? "/Manage" : ""}).
							</p>
							<form
								method="POST"
								action={collapseAction}
								hx-post={collapseAction}
								hx-target="#share-panel"
								hx-swap="outerHTML"
							>
								<button type="submit" class="btn btn-sm btn-secondary">
									Simplify now
								</button>
							</form>
						</div>
					)}

					{data.basicGrants.length > 0 ? (
						<div class="table-wrap">
							<table class="table">
								<thead>
									<tr>
										<th>Person</th>
										<th>Access</th>
										<th class="w-0" />
									</tr>
								</thead>
								<tbody>
									{data.basicGrants.map((g) => (
										<tr key={g.principalId}>
											<td class="text-fg">{g.principalLabel}</td>
											<td class="text-fg">
												{g.tier !== undefined ? (
													<form
														method="POST"
														action={setTierAction}
														hx-post={setTierAction}
														hx-target="#share-panel"
														hx-swap="outerHTML"
														class="inline"
													>
														<input
															type="hidden"
															name="principalId"
															value={g.principalId}
														/>
														<select name="tier" class="form-select">
															{data.tiers.map((t) => (
																<option
																	key={t.tier}
																	value={t.tier}
																	selected={t.tier === g.tier}
																>
																	{t.label}
																</option>
															))}
														</select>
														<button
															type="submit"
															class="btn btn-secondary btn-sm"
														>
															Update
														</button>
													</form>
												) : (
													<span
														class="text-xs text-subtle"
														title="Custom access — edit in Advanced mode"
													>
														Custom access
													</span>
												)}
											</td>
											<td class="text-right">
												<form
													method="POST"
													action={revokeAction}
													hx-post={revokeAction}
													hx-target="#share-panel"
													hx-swap="outerHTML"
													class="inline"
												>
													<input
														type="hidden"
														name="principalId"
														value={g.principalId}
													/>
													<button
														type="submit"
														class="link text-xs text-danger"
														title="Remove access"
													>
														Remove
													</button>
												</form>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					) : (
						<p class="text-sm text-muted">Not shared with anyone yet.</p>
					)}

					<div class="border-t border-line pt-4">
						<p class="form-label mb-2">Share with someone</p>
						<form
							method="POST"
							action={setTierAction}
							hx-post={setTierAction}
							hx-target="#share-panel"
							hx-swap="outerHTML"
							class="flex flex-wrap items-end gap-2"
						>
							<div class="form-group">
								<label
									for={`share-principal-${data.resourceId}`}
									class="form-label"
								>
									Person
								</label>
								<input
									type="text"
									id={`share-principal-${data.resourceId}`}
									name="principalSlug"
									list={`share-candidates-${data.resourceId}`}
									placeholder="Name, username, or email"
									class="form-input"
									autocomplete="off"
									hx-get={data.searchEndpoint}
									hx-trigger="keyup changed delay:250ms"
									hx-target={`#share-candidates-${data.resourceId}`}
									hx-swap="innerHTML"
									hx-params="*"
									required
								/>
								<datalist id={`share-candidates-${data.resourceId}`} />
							</div>
							<div class="form-group">
								<label for={`share-tier-${data.resourceId}`} class="form-label">
									Access
								</label>
								<select
									id={`share-tier-${data.resourceId}`}
									name="tier"
									class="form-select"
								>
									{data.tiers.map((t) => (
										<option key={t.tier} value={t.tier}>
											{t.label}
										</option>
									))}
								</select>
							</div>
							<button type="submit" class="btn btn-primary btn-sm">
								Share
							</button>
						</form>
					</div>
				</div>
			</details>

			{/* Advanced view */}
			<details open={data.defaultMode === "advanced"} class="space-y-4">
				<summary class="cursor-pointer text-sm font-medium">Advanced</summary>
				<div class="space-y-4 pt-2">
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
														hx-target="#share-panel"
														hx-swap="outerHTML"
														class="inline"
													>
														<input
															type="hidden"
															name="aceId"
															value={ace.aceId}
														/>
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
							hx-target="#share-panel"
							hx-swap="outerHTML"
							class="flex flex-wrap items-end gap-2"
						>
							<div class="form-group">
								<label
									for={`principalSlug-adv-${data.resourceId}`}
									class="form-label"
								>
									Username or group slug
								</label>
								<input
									type="text"
									id={`principalSlug-adv-${data.resourceId}`}
									name="principalSlug"
									placeholder="e.g. alice"
									class="form-input"
									required
								/>
							</div>
							<div class="form-group">
								<label for={`privilege-${data.resourceId}`} class="form-label">
									Privilege
								</label>
								<select
									id={`privilege-${data.resourceId}`}
									name="privilege"
									class="form-select"
								>
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
				</div>
			</details>
		</section>
	);
};
