import type { VNode } from "preact";
import type { SharePanelData } from "#src/http/ui/helpers/share-panel.ts";
import { Button } from "../components/button.tsx";
import {
	Alert,
	Card,
	type Column,
	EmptyState,
	Table,
} from "../components/display.tsx";
import { Field, TextInput } from "../components/form/form.tsx";
import { Select } from "../components/form/select.tsx";

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
	const tierOptions = data.tiers.map((t) => ({
		value: t.tier,
		label: t.label,
	}));

	type BasicGrant = (typeof data.basicGrants)[number];
	const basicColumns: ReadonlyArray<Column<BasicGrant>> = [
		{ header: "Person", cell: (g) => g.principalLabel },
		{
			header: "Access",
			cell: (g) =>
				g.tier !== undefined ? (
					<form
						method="POST"
						action={setTierAction}
						hx-post={setTierAction}
						hx-target="#share-panel"
						hx-swap="outerHTML"
						class="inline-flex items-center gap-2"
					>
						<input type="hidden" name="principalId" value={g.principalId} />
						<Select
							name="tier"
							aria-label="Access"
							options={tierOptions}
							value={g.tier}
							class="w-auto"
						/>
						<Button type="submit" size="sm">
							Update
						</Button>
					</form>
				) : (
					<span
						class="text-xs text-subtle"
						title="Custom access — edit in Advanced mode"
					>
						Custom access
					</span>
				),
		},
		{
			header: "",
			align: "right",
			shrink: true,
			cell: (g) => (
				<form
					method="POST"
					action={revokeAction}
					hx-post={revokeAction}
					hx-target="#share-panel"
					hx-swap="outerHTML"
					class="inline"
				>
					<input type="hidden" name="principalId" value={g.principalId} />
					<button
						type="submit"
						class="link text-xs text-danger"
						title="Remove access"
					>
						Remove
					</button>
				</form>
			),
		},
	];

	type Ace = (typeof data.aces)[number];
	const aceColumns: ReadonlyArray<Column<Ace>> = [
		{ header: "Principal", cell: (ace) => ace.principalLabel },
		{ header: "Privilege", cell: (ace) => ace.privilegeLabel },
		{
			header: "",
			align: "right",
			shrink: true,
			cell: (ace) =>
				ace.protected ? (
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
						<input type="hidden" name="aceId" value={ace.aceId} />
						<button
							type="submit"
							class="link text-xs text-danger"
							title="Revoke"
						>
							Revoke
						</button>
					</form>
				),
		},
	];

	return (
		<section id="share-panel">
			<Card title="Access control">
				<div class="space-y-4">
					{/* Basic view */}
					<details open={data.defaultMode === "basic"} class="space-y-4">
						<summary class="cursor-pointer text-sm font-medium">Simple</summary>
						<div class="space-y-4 pt-2">
							{!data.representableInBasic && (
								<Alert tone="warning" class="space-y-2 text-xs">
									<p>
										Some access here uses advanced options (custom privilege
										combinations, deny rules, or group/everyone grants) that
										Simple mode can't show individually. Making a change below
										will simplify that entry to the closest Simple option
										(View/Edit
										{data.tiers.some((t) => t.tier === "manage")
											? "/Manage"
											: ""}
										).
									</p>
									<form
										method="POST"
										action={collapseAction}
										hx-post={collapseAction}
										hx-target="#share-panel"
										hx-swap="outerHTML"
									>
										<Button type="submit" size="sm">
											Simplify now
										</Button>
									</form>
								</Alert>
							)}

							<Table
								columns={basicColumns}
								rows={data.basicGrants}
								getKey={(g) => g.principalId}
								empty={<EmptyState title="Not shared with anyone yet." />}
							/>

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
									<Field
										for={`share-principal-${data.resourceId}`}
										label="Person"
									>
										<TextInput
											id={`share-principal-${data.resourceId}`}
											name="principalSlug"
											list={`share-candidates-${data.resourceId}`}
											placeholder="Name, username, or email"
											autocomplete="off"
											hx-get={data.searchEndpoint}
											hx-trigger="keyup changed delay:250ms"
											hx-target={`#share-candidates-${data.resourceId}`}
											hx-swap="innerHTML"
											hx-params="*"
											required
										/>
										<datalist id={`share-candidates-${data.resourceId}`} />
									</Field>
									<Field for={`share-tier-${data.resourceId}`} label="Access">
										<Select
											id={`share-tier-${data.resourceId}`}
											name="tier"
											options={tierOptions}
										/>
									</Field>
									<Button type="submit" variant="primary" size="sm">
										Share
									</Button>
								</form>
							</div>
						</div>
					</details>

					{/* Advanced view */}
					<details open={data.defaultMode === "advanced"} class="space-y-4">
						<summary class="cursor-pointer text-sm font-medium">
							Advanced
						</summary>
						<div class="space-y-4 pt-2">
							<Table
								columns={aceColumns}
								rows={data.aces}
								getKey={(ace) => ace.aceId}
								empty={<EmptyState title="No access entries yet." />}
							/>

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
									<Field
										for={`principalSlug-adv-${data.resourceId}`}
										label="Username or group slug"
									>
										<TextInput
											id={`principalSlug-adv-${data.resourceId}`}
											name="principalSlug"
											placeholder="e.g. alice"
											required
										/>
									</Field>
									<Field for={`privilege-${data.resourceId}`} label="Privilege">
										<Select
											id={`privilege-${data.resourceId}`}
											name="privilege"
											options={data.privilegeOptions}
										/>
									</Field>
									<Button type="submit" variant="primary" size="sm">
										Grant
									</Button>
								</form>
							</div>
						</div>
					</details>
				</div>
			</Card>
		</section>
	);
};
