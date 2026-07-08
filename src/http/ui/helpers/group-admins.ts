import { Effect } from "effect";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import { AclService } from "#src/services/acl/service.ts";
import { PrincipalService } from "#src/services/principal/index.ts";

// ---------------------------------------------------------------------------
// buildGroupAdminsData — list the principals that hold DAV:all on a group
// principal. These are the users who can manage the group's membership via
// the proxy delegation model (RFC 3744 §5.6 / draft-ietf-acl-proxy).
//
// Returned rows are suitable for direct template rendering: id, display
// label, and the ACE id (for the per-row Remove form which POSTs to the
// existing aclRevokeHandler).
// ---------------------------------------------------------------------------

export interface GroupAdminRow {
	readonly aceId: string;
	readonly principalId: PrincipalId;
	readonly label: string;
}

export const buildGroupAdminsData = (
	groupPrincipalId: PrincipalId,
): Effect.Effect<
	ReadonlyArray<GroupAdminRow>,
	DatabaseError,
	AclService | PrincipalService
> =>
	Effect.gen(function* () {
		const acl = yield* AclService;
		const principalSvc = yield* PrincipalService;

		const aces = yield* acl.getAces(groupPrincipalId, "principal");

		const adminAces = aces.filter(
			(ace) =>
				ace.privilege === "DAV:all" &&
				ace.principalType === "principal" &&
				ace.principalId !== null,
		);
		// Resolve every admin principal in one query instead of one per ACE.
		const principals = yield* principalSvc.findPrincipalByIds(
			adminAces.map((ace) => ace.principalId as PrincipalId),
		);

		const admins: Array<GroupAdminRow> = adminAces.map((ace) => {
			const row = principals.get(ace.principalId as PrincipalId);
			return {
				aceId: ace.id,
				principalId: ace.principalId as PrincipalId,
				label: row
					? (row.displayName ?? row.slug)
					: (ace.principalId ?? "Unknown"),
			};
		});

		return admins;
	});
