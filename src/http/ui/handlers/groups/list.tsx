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
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { buildSharePanelData } from "#src/http/ui/helpers/share-panel.ts";
import { GroupsListPage } from "#src/http/ui/view/pages/groups.tsx";
import { renderPage } from "#src/http/ui/view/render.tsx";
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
	AclService | AppConfigService | GroupService | PrincipalService
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
			config.auth.basicAuthEnabled,
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

		const rows = groups.map((g) => {
			const privs = privMap.get(g.principal.id as PrincipalId) ?? [];
			return {
				id: g.principal.id,
				displayName: g.principal.displayName ?? "",
				slug: g.principal.slug,
				canEdit: hasVirtualWrite || privs.includes("DAV:write-properties"),
			};
		});

		const sharePanel = yield* buildSharePanelData(
			principal.principalId,
			GROUPS_VIRTUAL_RESOURCE_ID,
			"virtual",
		).pipe(Effect.map(Option.getOrUndefined));

		return yield* renderPage(
			<GroupsListPage
				groups={rows}
				canCreateGroup={canCreateGroup}
				sharePanel={sharePanel}
			/>,
			{ headers: ctx.headers, title: "Groups", nav },
		);
	});
