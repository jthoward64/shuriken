import { Effect, Option } from "effect";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import type { AclResourceType } from "#src/services/acl/index.ts";
import { type AclResourceId, AclService } from "#src/services/acl/service.ts";
import { PrincipalService } from "#src/services/principal/index.ts";

// ---------------------------------------------------------------------------
// AclPanelData — data model for the acl-panel.hbs partial
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

export interface AclPanelData {
	readonly resourceType: string;
	readonly resourceId: string;
	readonly aces: ReadonlyArray<AclPanelAce>;
	readonly privilegeOptions: ReadonlyArray<{
		readonly value: string;
		readonly label: string;
	}>;
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
};

export const COMMON_PRIVILEGE_OPTIONS: ReadonlyArray<{
	readonly value: string;
	readonly label: string;
}> = [
	{ value: "DAV:all", label: "Full control" },
	{ value: "DAV:read", label: "Read" },
	{ value: "DAV:write", label: "Write" },
	{ value: "DAV:write-acl", label: "Manage access" },
];

// ---------------------------------------------------------------------------
// buildAclPanelData — returns None if the caller lacks DAV:write-acl
// ---------------------------------------------------------------------------

export const buildAclPanelData = (
	actingPrincipalId: PrincipalId,
	resourceId: AclResourceId,
	resourceType: AclResourceType,
): Effect.Effect<
	Option.Option<AclPanelData>,
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

		const enrichedAces: Array<AclPanelAce> = [];
		for (const ace of rawAces) {
			let principalLabel: string;
			let resolvedPrincipalId: string | null = null;

			if (ace.principalType === "principal" && ace.principalId != null) {
				const maybeRow = yield* principalService
					.findPrincipalById(ace.principalId as PrincipalId)
					.pipe(
						Effect.map(
							Option.some<
								import("#src/services/principal/repository.ts").PrincipalRow
							>,
						),
						Effect.catchTag("DavError", () => Effect.succeed(Option.none())),
					);
				principalLabel = Option.match(maybeRow, {
					onNone: () => ace.principalId ?? "Unknown",
					onSome: (p) => p.displayName ?? p.slug,
				});
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

		return Option.some<AclPanelData>({
			resourceType,
			resourceId: resourceId as string,
			aces: enrichedAces,
			privilegeOptions: COMMON_PRIVILEGE_OPTIONS,
		});
	});
