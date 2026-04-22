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
import { buildAclPanelData } from "#src/http/ui/helpers/acl-panel.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { renderFragment } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import type { AclResourceType, NewAce } from "#src/services/acl/index.ts";
import { type AclResourceId, AclService } from "#src/services/acl/service.ts";
import type { PrincipalService } from "#src/services/principal/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/acl/:resourceType/:resourceId/revoke
// ---------------------------------------------------------------------------

export const aclRevokeHandler = (
	req: Request,
	ctx: HttpRequestContext,
	resourceType: AclResourceType,
	resourceId: AclResourceId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | PrincipalService | TemplateService
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
		if (!aceId) {
			return new Response("Missing aceId", { status: 400 });
		}

		const existingAces = yield* acl.getAces(resourceId, resourceType);
		const nextAces: ReadonlyArray<NewAce> = existingAces
			.filter((a) => !a.protected && a.id !== aceId)
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

		const panelData = yield* buildAclPanelData(
			principal.principalId,
			resourceId,
			resourceType,
		);
		return yield* renderFragment("partials/acl-panel", {
			aclPanel: Option.getOrUndefined(panelData),
		});
	});
