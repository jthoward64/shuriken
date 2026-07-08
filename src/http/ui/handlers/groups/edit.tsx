import { Effect, Option } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { GroupId, PrincipalId, UserId } from "#src/domain/ids.ts";
import { GROUPS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { buildAclPanelData } from "#src/http/ui/helpers/acl-panel.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildGroupAdminsData } from "#src/http/ui/helpers/group-admins.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { GroupEditPage } from "#src/http/ui/view/pages/groups.tsx";
import { renderPage } from "#src/http/ui/view/render.tsx";
import { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { GroupService } from "#src/services/group/index.ts";
import type { PrincipalService } from "#src/services/principal/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/groups/:principalId
// ---------------------------------------------------------------------------

export const groupsEditHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	principalId: PrincipalId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclService
	| AppConfigService
	| CollectionService
	| GroupService
	| PrincipalService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const acl = yield* AclService;
		const groupService = yield* GroupService;
		const collectionService = yield* CollectionService;

		const { group, principal: principalRow } =
			yield* groupService.findByPrincipalId(principalId);

		const groupsVirtualPrivs = yield* acl.currentUserPrivileges(
			principal.principalId,
			GROUPS_VIRTUAL_RESOURCE_ID,
			"virtual",
		);
		if (!groupsVirtualPrivs.includes("DAV:write-properties")) {
			yield* acl.check(
				principal.principalId,
				principalRow.id as PrincipalId,
				"principal",
				"DAV:write-properties",
			);
		}

		const [members, allCollections] = yield* Effect.all([
			groupService.listMembers(group.id as GroupId),
			collectionService.listByOwner(principalRow.id as PrincipalId),
		]);

		const canDelete = groupsVirtualPrivs.includes("DAV:unbind");

		const collections = allCollections
			.filter(
				(c) =>
					c.collectionType === "calendar" || c.collectionType === "addressbook",
			)
			.map((c) => ({
				id: c.id,
				displayName: c.displayName ?? c.slug,
				collectionType: c.collectionType,
			}));

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		const aclPanel = yield* buildAclPanelData(
			principal.principalId,
			principalRow.id as PrincipalId,
			"principal",
		).pipe(Effect.map(Option.getOrUndefined));

		const groupAdmins = yield* buildGroupAdminsData(
			principalRow.id as PrincipalId,
		);

		return yield* renderPage(
			<GroupEditPage
				principalId={principalRow.id}
				title={principalRow.displayName ?? principalRow.slug}
				displayName={principalRow.displayName ?? ""}
				slug={principalRow.slug}
				canDelete={canDelete}
				collections={collections}
				aclPanel={aclPanel}
				groupAdmins={groupAdmins.map((a) => ({
					aceId: a.aceId,
					label: a.label,
				}))}
				members={members.map((m) => ({
					id: m.user.id as UserId,
					label: m.principal.displayName ?? m.principal.slug,
					slug: m.principal.slug,
					autoAssignedBy: m.autoAssignedBy,
				}))}
				oidcSyncEnabled={config.auth.oidcEnabled}
				oidcGroups={group.oidcGroups}
			/>,
			{
				headers: ctx.headers,
				title: principalRow.displayName ?? principalRow.slug,
				nav,
			},
		);
	});
