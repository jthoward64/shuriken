import type { DavPrivilege } from "#src/domain/types/dav.ts";
import type { AceRow, AclResourceType } from "#src/services/acl/repository.ts";

// ---------------------------------------------------------------------------
// Share tiers — friendly Basic-mode groupings over the raw DavPrivilege
// vocabulary, used by the Share UI's Basic/Advanced toggle (see
// src/http/ui/helpers/share-panel.ts, src/http/ui/view/pages/share-panel.tsx).
//
// Instances (single calendar events) get 2 tiers: view/edit.
// Collections (calendars/address books) get 4: free_busy/view/edit/manage.
// free_busy and manage are calendar-only in the UI (gate on collectionType
// === "calendar" at the call site) — address books never show them.
// ---------------------------------------------------------------------------

export type ShareTier = "free_busy" | "view" | "edit" | "manage";

export interface TierDefinition {
	readonly tier: ShareTier;
	readonly label: string;
	readonly privileges: ReadonlyArray<DavPrivilege>;
}

const FREE_BUSY: TierDefinition = {
	tier: "free_busy",
	label: "Free/busy only",
	privileges: ["CALDAV:read-free-busy"],
};

const VIEW: TierDefinition = {
	tier: "view",
	label: "Can view",
	privileges: ["DAV:read"],
};

const EDIT: TierDefinition = {
	tier: "edit",
	label: "Can edit",
	privileges: ["DAV:read", "DAV:write"],
};

const MANAGE: TierDefinition = {
	tier: "manage",
	label: "Can manage sharing",
	privileges: ["DAV:read", "DAV:write", "DAV:write-acl"],
};

/** Tiers offered for a given resource type + collection kind. */
export const tiersFor = (
	resourceType: AclResourceType,
	isCalendar: boolean,
): ReadonlyArray<TierDefinition> => {
	if (resourceType !== "collection") {
		// Instances: view/edit only — no per-event delegation, no free-busy
		// concept for a single event.
		return [VIEW, EDIT];
	}
	return isCalendar ? [FREE_BUSY, VIEW, EDIT, MANAGE] : [VIEW, EDIT];
};

// The linear hierarchy used by collapseToBasicTiers' "round up" step.
// free_busy is deliberately excluded — it's a narrower, disjoint grant, not
// a rung on the view<edit<manage ladder (someone with DAV:read already
// implies free/busy visibility, so free_busy is "less than view", not
// comparable via subset).
const ROUND_UP_CHAIN: ReadonlyArray<TierDefinition> = [VIEW, EDIT, MANAGE];

const privSetsEqual = (
	a: ReadonlyArray<DavPrivilege>,
	b: ReadonlyArray<DavPrivilege>,
): boolean => {
	if (a.length !== b.length) {
		return false;
	}
	const bSet = new Set(b);
	return a.every((p) => bSet.has(p));
};

interface RawGrant {
	readonly principalId: string;
	readonly privileges: ReadonlyArray<DavPrivilege>;
}

/** Groups non-protected grant ACEs by principal (deny/pseudo/group excluded
 * by the caller before this runs — see isRepresentableInBasicTiers). */
const groupByPrincipal = (
	aces: ReadonlyArray<AceRow>,
): ReadonlyArray<RawGrant> => {
	const byPrincipal = new Map<string, Array<DavPrivilege>>();
	for (const ace of aces) {
		if (ace.principalType !== "principal" || ace.principalId == null) {
			continue;
		}
		const list = byPrincipal.get(ace.principalId) ?? [];
		list.push(ace.privilege as DavPrivilege);
		byPrincipal.set(ace.principalId, list);
	}
	return [...byPrincipal.entries()].map(([principalId, privileges]) => ({
		principalId,
		privileges,
	}));
};

/**
 * True when every grantee's privilege set on this resource can be shown
 * exactly as one Basic tier, with no loss of information. False whenever
 * the resource has a deny ACE, a pseudo-principal grant (all/authenticated/
 * unauthenticated/self), a group grant, or any grantee whose privilege set
 * doesn't exactly equal one tier's canonical set. Protected (server-managed)
 * ACEs are always ignored — never user-editable in either mode.
 */
export const isRepresentableInBasicTiers = (
	aces: ReadonlyArray<AceRow>,
	resourceType: AclResourceType,
	isCalendar: boolean,
): boolean => {
	const nonProtected = aces.filter((a) => !a.protected);
	if (nonProtected.some((a) => a.grantDeny === "deny")) {
		return false;
	}
	if (
		nonProtected.some(
			(a) => a.principalType !== "principal" || a.principalId == null,
		)
	) {
		return false;
	}
	const tiers = tiersFor(resourceType, isCalendar);
	const grants = groupByPrincipal(nonProtected);
	return grants.every((g) =>
		tiers.some((t) => privSetsEqual(t.privileges, g.privileges)),
	);
};

/** The matched tier per principal, valid only when isRepresentableInBasicTiers
 * is true for the same input. */
export const basicTierForGrant = (
	privileges: ReadonlyArray<DavPrivilege>,
	resourceType: AclResourceType,
	isCalendar: boolean,
): ShareTier | undefined =>
	tiersFor(resourceType, isCalendar).find((t) =>
		privSetsEqual(t.privileges, privileges),
	)?.tier;

export interface CollapsedGrant {
	readonly principalId: string;
	readonly tier: ShareTier;
}

/**
 * Best-effort collapse of the current ACL state onto Basic tiers, run only
 * on explicit user confirmation when isRepresentableInBasicTiers is false.
 * Deny ACEs, pseudo-principal grants, and group grants are dropped (the
 * documented loss the confirmation warns about). Each remaining principal's
 * granted privileges are unioned and rounded UP to the highest tier in
 * view<edit<manage whose canonical set is a subset of that union — biasing
 * toward not losing access the owner intended to keep. A principal with
 * leftover privileges that don't overlap any tier (e.g. a lone
 * DAV:read-acl) still gets a floor of `view` rather than being dropped.
 * free_busy never participates in this rounding (see ROUND_UP_CHAIN) — a
 * principal is only ever collapsed onto free_busy by the exact-match check
 * in isRepresentableInBasicTiers, never by this best-effort path.
 */
export const collapseToBasicTiers = (
	aces: ReadonlyArray<AceRow>,
): ReadonlyArray<CollapsedGrant> => {
	const nonProtected = aces.filter(
		(a) =>
			!a.protected &&
			a.grantDeny === "grant" &&
			a.principalType === "principal" &&
			a.principalId != null,
	);
	const grants = groupByPrincipal(nonProtected);
	const collapsed: Array<CollapsedGrant> = [];
	for (const g of grants) {
		const union = new Set(g.privileges);
		let matched: ShareTier | undefined;
		for (const t of ROUND_UP_CHAIN) {
			if (t.privileges.every((p) => union.has(p))) {
				matched = t.tier;
			}
		}
		collapsed.push({ principalId: g.principalId, tier: matched ?? "view" });
	}
	return collapsed;
};
