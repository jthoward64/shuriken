import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { GroupId, PrincipalId, UserId } from "#src/domain/ids.ts";
import {
	GROUPS_VIRTUAL_RESOURCE_ID,
	USERS_VIRTUAL_RESOURCE_ID,
} from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { GroupService } from "#src/services/group/index.ts";
import { PrincipalService } from "#src/services/principal/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/users/:principalId
// ---------------------------------------------------------------------------

export const usersEditHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	principalId: PrincipalId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | CollectionService | GroupService | PrincipalService | TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const acl = yield* AclService;
		const principalService = yield* PrincipalService;
		const groupService = yield* GroupService;
		const collectionService = yield* CollectionService;

		const { user, principal: principalRow } =
			yield* principalService.findById(principalId);

		const isSelf = user.id === principal.userId;
		if (!isSelf) {
			const usersVirtualPrivs = yield* acl.currentUserPrivileges(
				principal.principalId,
				USERS_VIRTUAL_RESOURCE_ID,
				"virtual",
			);
			if (!usersVirtualPrivs.includes("DAV:write-properties")) {
				yield* acl.check(
					principal.principalId,
					principalRow.id as PrincipalId,
					"principal",
					"DAV:write-properties",
				);
			}
		}

		const [allGroups, userGroups, allCollections] = yield* Effect.all([
			groupService.list(),
			groupService.listByMember(user.id as UserId),
			collectionService.listByOwner(principalRow.id as PrincipalId),
		]);

		const userGroupIds = new Set(userGroups.map((g) => g.group.id));

		const groupPrincipalIds = allGroups.map(
			(g) => g.principal.id as PrincipalId,
		);
		const [groupPrivMap, groupsVirtualPrivs, usersPrivs] = yield* Effect.all([
			acl.batchCurrentUserPrivileges(
				principal.principalId,
				groupPrincipalIds,
				"principal",
			),
			acl.currentUserPrivileges(
				principal.principalId,
				GROUPS_VIRTUAL_RESOURCE_ID,
				"virtual",
			),
			acl.currentUserPrivileges(
				principal.principalId,
				USERS_VIRTUAL_RESOURCE_ID,
				"virtual",
			),
		]);

		const hasGroupsVirtualWrite = groupsVirtualPrivs.includes("DAV:write-properties");
		const canEditSlug = usersPrivs.includes("DAV:unbind");
		const canDelete = usersPrivs.includes("DAV:unbind");

		const collections = allCollections
			.filter((c) => c.collectionType === "calendar" || c.collectionType === "addressbook")
			.map((c) => ({
				id: c.id,
				slug: c.slug,
				displayName: c.displayName ?? c.slug,
				collectionType: c.collectionType,
			}));

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.mode,
		);

		const enrichedGroups = allGroups.map((g) => {
			const privs = groupPrivMap.get(g.principal.id as PrincipalId) ?? [];
			return {
				group: g.group,
				principal: g.principal,
				isMember: userGroupIds.has(g.group.id as GroupId),
				canManageMembers:
					hasGroupsVirtualWrite || privs.includes("DAV:write-properties"),
			};
		});

		const origin = ctx.url.origin;
		const davBase = `${origin}/dav/principals/${principalRow.id}`;

		return yield* renderPage(
			"pages/users/edit",
			{
				...nav,
				pageTitle: principalRow.displayName ?? principalRow.slug,
				user,
				principal: principalRow,
				groups: enrichedGroups,
				canEditSlug,
				canDelete,
				showPasswordForm: config.auth.mode === "basic",
				isSelf,
				collections,
				principalUrl: `${davBase}/`,
				caldavUrl: `${davBase}/cal/`,
				carddavUrl: `${davBase}/card/`,
			},
			ctx.headers,
		);
	});
