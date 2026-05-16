import { Effect, Option } from "effect";
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
		const admins: Array<GroupAdminRow> = [];

		for (const ace of aces) {
			if (ace.privilege !== "DAV:all") {
				continue;
			}
			if (ace.principalType !== "principal" || ace.principalId === null) {
				continue;
			}
			const rowOpt = yield* principalSvc
				.findPrincipalById(ace.principalId as PrincipalId)
				.pipe(
					Effect.map(
						Option.some<
							import("#src/services/principal/repository.ts").PrincipalRow
						>,
					),
					Effect.catchTag("DavError", () => Effect.succeed(Option.none())),
				);
			const label = Option.match(rowOpt, {
				onNone: () => ace.principalId ?? "Unknown",
				onSome: (p) => p.displayName ?? p.slug,
			});
			admins.push({
				aceId: ace.id,
				principalId: ace.principalId as PrincipalId,
				label,
			});
		}

		return admins;
	});
