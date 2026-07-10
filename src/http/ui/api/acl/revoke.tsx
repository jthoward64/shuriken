import { Effect, Option } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { InternalError as InternalErr } from "#src/domain/errors.ts";
import type { UuidString } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import {
	buildSharePanelData,
	resolveIsCalendar,
} from "#src/http/ui/helpers/share-panel.ts";
import { SharePanel } from "#src/http/ui/view/pages/share-panel.tsx";
import { renderFragment } from "#src/http/ui/view/render.tsx";
import type { AclResourceType, NewAce } from "#src/services/acl/index.ts";
import { type AclResourceId, AclService } from "#src/services/acl/service.ts";
import type { CollectionService } from "#src/services/collection/index.ts";
import type { PrincipalService } from "#src/services/principal/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/acl/:resourceType/:resourceId/revoke
//
// Accepts either `aceId` (Advanced mode — remove exactly one ACE row) or
// `principalId` (Basic mode's "Remove access" — remove every non-protected
// ACE row for that principal on this resource in one call, since a Basic
// grant may span 1-3 rows).
// ---------------------------------------------------------------------------

export const aclRevokeHandler = (
	req: Request,
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

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalErr({ cause: e }),
		});

		const aceId = form.get("aceId")?.toString()?.trim() ?? "";
		const principalId = form.get("principalId")?.toString()?.trim() ?? "";
		if (!aceId && !principalId) {
			return new Response("Missing aceId or principalId", { status: 400 });
		}

		const existingAces = yield* acl.getAces(resourceId, resourceType);
		const nextAces: ReadonlyArray<NewAce> = existingAces
			.filter((a) => {
				if (a.protected) {
					return true;
				}
				if (aceId) {
					return a.id !== aceId;
				}
				return a.principalId !== principalId;
			})
			.map(
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
			);

		yield* acl.setAces(resourceId, resourceType, nextAces);

		const isCalendar = yield* resolveIsCalendar(resourceType, resourceId);
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
