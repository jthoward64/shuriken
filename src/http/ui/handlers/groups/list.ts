import { Effect, Option } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import { GROUPS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { buildAclPanelData } from "#src/http/ui/helpers/acl-panel.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import { AclService } from "#src/services/acl/index.ts";
import { GroupService } from "#src/services/group/index.ts";
import type { PrincipalService } from "#src/services/principal/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/groups
// ---------------------------------------------------------------------------

export const groupsListHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclService
	| AppConfigService
	| GroupService
	| PrincipalService
	| TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const acl = yield* AclService;
		const groupService = yield* GroupService;

		yield* acl.check(
			principal.principalId,
			GROUPS_VIRTUAL_RESOURCE_ID,
			"virtual",
			"DAV:read",
		);

		const groups = yield* groupService.list();
		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.mode,
		);

		const groupPrincipalIds = groups.map((g) => g.principal.id as PrincipalId);
		const privMap = yield* acl.batchCurrentUserPrivileges(
			principal.principalId,
			groupPrincipalIds,
			"principal",
		);

		// Virtual resource grants apply to all groups in the collection
		const groupsVirtualPrivs = yield* acl.currentUserPrivileges(
			principal.principalId,
			GROUPS_VIRTUAL_RESOURCE_ID,
			"virtual",
		);
		const canCreateGroup = groupsVirtualPrivs.includes("DAV:bind");
		const hasVirtualWrite = groupsVirtualPrivs.includes("DAV:write-properties");
		const hasVirtualUnbind = groupsVirtualPrivs.includes("DAV:unbind");

		const enrichedGroups = groups.map((g) => {
			const privs = privMap.get(g.principal.id as PrincipalId) ?? [];
			return {
				principal: g.principal,
				group: g.group,
				canEdit: hasVirtualWrite || privs.includes("DAV:write-properties"),
				canDelete: hasVirtualUnbind || privs.includes("DAV:unbind"),
			};
		});

		const aclPanel = yield* buildAclPanelData(
			principal.principalId,
			GROUPS_VIRTUAL_RESOURCE_ID,
			"virtual",
		).pipe(Effect.map(Option.getOrUndefined));

		return yield* renderPage(
			"pages/groups/list",
			{
				...nav,
				pageTitle: "Groups",
				groups: enrichedGroups,
				canCreateGroup,
				aclPanel,
			},
			ctx.headers,
		);
	});
