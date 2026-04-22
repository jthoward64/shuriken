import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { GroupId, PrincipalId, UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import { USERS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import { AclService } from "#src/services/acl/index.ts";
import { GroupService } from "#src/services/group/index.ts";
import { UserService } from "#src/services/user/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/users/:slug
// ---------------------------------------------------------------------------

export const usersEditHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	slug: Slug,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | GroupService | TemplateService | UserService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const acl = yield* AclService;
		const userService = yield* UserService;
		const groupService = yield* GroupService;

		const { user, principal: principalRow } =
			yield* userService.findBySlug(slug);

		// Must have DAV:write-properties on this principal OR be viewing self
		const isSelf = user.id === principal.userId;
		if (!isSelf) {
			yield* acl.check(
				principal.principalId,
				principalRow.id as PrincipalId,
				"principal",
				"DAV:write-properties",
			);
		}

		const [allGroups, userGroups] = yield* Effect.all([
			groupService.list(),
			groupService.listByMember(user.id as UserId),
		]);

		const userGroupIds = new Set(userGroups.map((g) => g.group.id));

		// Check which groups the caller can manage membership for
		const groupPrincipalIds = allGroups.map(
			(g) => g.principal.id as PrincipalId,
		);
		const groupPrivMap = yield* acl.batchCurrentUserPrivileges(
			principal.principalId,
			groupPrincipalIds,
			"principal",
		);

		// canEditSlug requires DAV:unbind on the users virtual resource
		const usersPrivs = yield* acl.currentUserPrivileges(
			principal.principalId,
			USERS_VIRTUAL_RESOURCE_ID,
			"virtual",
		);
		const canEditSlug = usersPrivs.includes("DAV:unbind");
		const canDelete =
			usersPrivs.includes("DAV:unbind") ||
			(isSelf && usersPrivs.includes("DAV:unbind"));

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
				canManageMembers: privs.includes("DAV:write-properties"),
			};
		});

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
			},
			ctx.headers,
		);
	});
