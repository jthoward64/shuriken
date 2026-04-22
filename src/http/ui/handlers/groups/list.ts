import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import { GROUPS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import { AclService } from "#src/services/acl/index.ts";
import { GroupService } from "#src/services/group/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/groups
// ---------------------------------------------------------------------------

export const groupsListHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | GroupService | TemplateService
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

		const canCreateGroup = (yield* acl.currentUserPrivileges(
			principal.principalId,
			GROUPS_VIRTUAL_RESOURCE_ID,
			"virtual",
		)).includes("DAV:bind");

		const enrichedGroups = groups.map((g) => {
			const privs = privMap.get(g.principal.id as PrincipalId) ?? [];
			return {
				principal: g.principal,
				group: g.group,
				canEdit: privs.includes("DAV:write-properties"),
				canDelete: privs.includes("DAV:unbind"),
			};
		});

		return yield* renderPage(
			"pages/groups/list",
			{
				...nav,
				pageTitle: "Groups",
				groups: enrichedGroups,
				canCreateGroup,
			},
			ctx.headers,
		);
	});
