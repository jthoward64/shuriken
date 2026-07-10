import { Effect, Option } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import type { AclResourceType } from "#src/services/acl/index.ts";
import { type AclResourceId, AclService } from "#src/services/acl/service.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { PrincipalService } from "#src/services/principal/index.ts";
import {
	basicTierForGrant,
	isRepresentableInBasicTiers,
	type ShareTier,
	tiersFor,
} from "./share-tiers.ts";

/**
 * Resolves whether an ACL resource is a calendar collection — needed to
 * decide which Basic tiers to offer (free_busy/manage are calendar-only).
 * Always false for non-collection resource types.
 */
export const resolveIsCalendar = (
	resourceType: AclResourceType,
	resourceId: AclResourceId,
): Effect.Effect<boolean, DavError | DatabaseError, CollectionService> =>
	Effect.gen(function* () {
		if (resourceType !== "collection") {
			return false;
		}
		const collSvc = yield* CollectionService;
		const coll = yield* collSvc.findById(resourceId as CollectionId);
		return coll.collectionType === "calendar";
	});

// ---------------------------------------------------------------------------
// SharePanelData — data model for the share-panel.tsx component (renders as
// "Basic" tiers by default, with an "Advanced" per-privilege view available
// via toggle; see src/http/ui/view/pages/share-panel.tsx).
// ---------------------------------------------------------------------------

export interface AclPanelAce {
	readonly aceId: string;
	readonly principalLabel: string;
	readonly principalId: string | null;
	readonly principalType: string;
	readonly privilege: string;
	readonly privilegeLabel: string;
	readonly protected: boolean;
}

export interface BasicGrant {
	readonly principalId: string;
	readonly principalLabel: string;
	/** undefined when this principal's raw privilege set doesn't exactly
	 * match a tier — e.g. after a partial edit in Advanced mode. Basic mode
	 * shows these principals but can't offer an in-place tier edit for them
	 * without first collapsing (see the /collapse endpoint). */
	readonly tier: ShareTier | undefined;
}

export interface SharePanelData {
	readonly resourceType: string;
	readonly resourceId: string;
	readonly aces: ReadonlyArray<AclPanelAce>;
	readonly privilegeOptions: ReadonlyArray<{
		readonly value: string;
		readonly label: string;
	}>;
	readonly tiers: ReadonlyArray<{
		readonly tier: ShareTier;
		readonly label: string;
	}>;
	readonly basicGrants: ReadonlyArray<BasicGrant>;
	readonly defaultMode: "basic" | "advanced";
	readonly representableInBasic: boolean;
	readonly searchEndpoint: string;
}

// ---------------------------------------------------------------------------
// Display label maps
// ---------------------------------------------------------------------------

const PSEUDO_PRINCIPAL_LABELS: Record<string, string> = {
	all: "All users",
	authenticated: "Authenticated users",
	unauthenticated: "Unauthenticated users",
	self: "Resource owner (self)",
};

const PRIVILEGE_LABELS: Partial<Record<string, string>> = {
	"DAV:all": "Full control",
	"DAV:read": "Read",
	"DAV:write": "Write",
	"DAV:write-acl": "Manage access",
	"DAV:write-properties": "Write properties",
	"DAV:write-content": "Write content",
	"DAV:bind": "Create resources",
	"DAV:unbind": "Delete resources",
	"DAV:read-acl": "Read access list",
	"DAV:read-current-user-privilege-set": "Read own privileges",
	"DAV:unlock": "Unlock",
	"CALDAV:read-free-busy": "Free/busy only",
};

export const COMMON_PRIVILEGE_OPTIONS: ReadonlyArray<{
	readonly value: string;
	readonly label: string;
}> = [
	{ value: "DAV:all", label: "Full control" },
	{ value: "DAV:read", label: "Read" },
	{ value: "DAV:write", label: "Write" },
	{ value: "DAV:write-acl", label: "Manage access" },
	{ value: "CALDAV:read-free-busy", label: "Free/busy only" },
];

// ---------------------------------------------------------------------------
// buildSharePanelData — returns None if the caller lacks DAV:write-acl
// ---------------------------------------------------------------------------

export const buildSharePanelData = (
	actingPrincipalId: PrincipalId,
	resourceId: AclResourceId,
	resourceType: AclResourceType,
	isCalendar = false,
): Effect.Effect<
	Option.Option<SharePanelData>,
	DatabaseError,
	AclService | PrincipalService
> =>
	Effect.gen(function* () {
		const acl = yield* AclService;
		const principalService = yield* PrincipalService;

		const privs = yield* acl.currentUserPrivileges(
			actingPrincipalId,
			resourceId,
			resourceType,
		);
		if (!privs.includes("DAV:write-acl")) {
			return Option.none();
		}

		const rawAces = yield* acl.getAces(resourceId, resourceType);

		// Resolve every referenced principal in one query instead of one per ACE.
		const principalIds = rawAces.flatMap((ace) =>
			ace.principalType === "principal" && ace.principalId != null
				? [ace.principalId as PrincipalId]
				: [],
		);
		const principals = yield* principalService.findPrincipalByIds(principalIds);

		const enrichedAces: Array<AclPanelAce> = [];
		for (const ace of rawAces) {
			let principalLabel: string;
			let resolvedPrincipalId: string | null = null;

			if (ace.principalType === "principal" && ace.principalId != null) {
				const row = principals.get(ace.principalId as PrincipalId);
				principalLabel = row
					? (row.displayName ?? row.slug)
					: (ace.principalId ?? "Unknown");
				resolvedPrincipalId = ace.principalId;
			} else {
				principalLabel =
					PSEUDO_PRINCIPAL_LABELS[ace.principalType] ?? ace.principalType;
			}

			enrichedAces.push({
				aceId: ace.id,
				principalLabel,
				principalId: resolvedPrincipalId,
				principalType: ace.principalType,
				privilege: ace.privilege,
				privilegeLabel: PRIVILEGE_LABELS[ace.privilege] ?? ace.privilege,
				protected: ace.protected,
			});
		}

		const representable = isRepresentableInBasicTiers(
			rawAces,
			resourceType,
			isCalendar,
		);

		const byPrincipal = new Map<string, Array<AclPanelAce>>();
		for (const ace of enrichedAces) {
			if (
				ace.protected ||
				ace.principalType !== "principal" ||
				!ace.principalId
			) {
				continue;
			}
			const list = byPrincipal.get(ace.principalId) ?? [];
			list.push(ace);
			byPrincipal.set(ace.principalId, list);
		}
		const basicGrants: Array<BasicGrant> = [...byPrincipal.entries()].map(
			([principalId, group]) => ({
				principalId,
				principalLabel: group[0]?.principalLabel ?? principalId,
				tier: basicTierForGrant(
					group.map((a) => a.privilege as DavPrivilege),
					resourceType,
					isCalendar,
				),
			}),
		);

		return Option.some<SharePanelData>({
			resourceType,
			resourceId: resourceId as string,
			aces: enrichedAces,
			privilegeOptions: COMMON_PRIVILEGE_OPTIONS,
			tiers: tiersFor(resourceType, isCalendar),
			basicGrants,
			defaultMode: representable ? "basic" : "advanced",
			representableInBasic: representable,
			searchEndpoint: `/ui/api/principals/search?resourceType=${resourceType}&resourceId=${resourceId}`,
		});
	});
