import { Effect, Option } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { UuidString } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	buildSharePanelData,
	resolveIsCalendar,
} from "#src/http/ui/helpers/share-panel.ts";
import {
	collapseToBasicTiers,
	tiersFor,
} from "#src/http/ui/helpers/share-tiers.ts";
import { SharePanel } from "#src/http/ui/view/pages/share-panel.tsx";
import { renderFragment } from "#src/http/ui/view/render.tsx";
import type { AclResourceType, NewAce } from "#src/services/acl/index.ts";
import { type AclResourceId, AclService } from "#src/services/acl/service.ts";
import type { CollectionService } from "#src/services/collection/index.ts";
import type { PrincipalService } from "#src/services/principal/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/acl/:resourceType/:resourceId/collapse — confirmed
// Advanced→Basic switch when the current ACL state isn't exactly
// representable by the tiers. Best-effort maps every grantee onto the
// nearest tier (dropping deny/pseudo-principal/group grants — the
// documented loss the confirmation warned about) and persists the
// collapsed state in one setAces call.
// ---------------------------------------------------------------------------

export const aclCollapseHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	resourceType: AclResourceType,
	resourceId: AclResourceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | PrincipalService | CollectionService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;

		yield* acl.check(
			principal.principalId,
			resourceId,
			resourceType,
			"DAV:write-acl",
		);

		const isCalendar = yield* resolveIsCalendar(resourceType, resourceId);
		const tierByName = new Map(
			tiersFor(resourceType, isCalendar).map((t) => [t.tier, t]),
		);

		const existingAces = yield* acl.getAces(resourceId, resourceType);
		const protectedAces = existingAces.filter((a) => a.protected);
		const collapsed = collapseToBasicTiers(existingAces);

		const nextAces: ReadonlyArray<NewAce> = [
			...protectedAces.map(
				(a): NewAce => ({
					resourceType: a.resourceType,
					resourceId: a.resourceId as UuidString,
					principalType: a.principalType,
					principalId: a.principalId as UuidString | undefined,
					privilege: a.privilege as DavPrivilege,
					grantDeny: a.grantDeny,
					protected: a.protected,
					ordinal: a.ordinal,
				}),
			),
			...collapsed.flatMap((g, gi) => {
				const tier = tierByName.get(g.tier);
				if (!tier) {
					return [];
				}
				return tier.privileges.map(
					(privilege, pi): NewAce => ({
						resourceType,
						resourceId: resourceId as UuidString,
						principalType: "principal",
						principalId: g.principalId as UuidString,
						privilege,
						grantDeny: "grant",
						protected: false,
						ordinal: gi * 10 + pi,
					}),
				);
			}),
		];

		yield* acl.setAces(resourceId, resourceType, nextAces);

		const panelData = yield* buildSharePanelData(
			principal.principalId,
			resourceId,
			resourceType,
			isCalendar,
		);
		return yield* renderFragment(
			<SharePanel data={Option.getOrUndefined(panelData)} />,
		);
	});
