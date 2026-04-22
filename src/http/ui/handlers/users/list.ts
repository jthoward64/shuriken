import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import { USERS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import { AclService } from "#src/services/acl/index.ts";
import { UserService } from "#src/services/user/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/users
// ---------------------------------------------------------------------------

export const usersListHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | TemplateService | UserService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const acl = yield* AclService;
		const userService = yield* UserService;

		// ACL: caller must have DAV:read on the users virtual resource
		yield* acl.check(
			principal.principalId,
			USERS_VIRTUAL_RESOURCE_ID,
			"virtual",
			"DAV:read",
		);

		const users = yield* userService.list();
		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.mode,
		);

		// Batch-check per-user permissions for the current caller
		const userPrincipalIds = users.map((u) => u.principal.id as PrincipalId);
		const privMap = yield* acl.batchCurrentUserPrivileges(
			principal.principalId,
			userPrincipalIds,
			"principal",
		);

		const canCreateUser = (yield* acl.currentUserPrivileges(
			principal.principalId,
			USERS_VIRTUAL_RESOURCE_ID,
			"virtual",
		)).includes("DAV:bind");

		const enrichedUsers = users.map((u) => {
			const privs = privMap.get(u.principal.id as PrincipalId) ?? [];
			return {
				principal: u.principal,
				user: u.user,
				canEdit: privs.includes("DAV:write-properties"),
				canDelete: privs.includes("DAV:unbind"),
			};
		});

		return yield* renderPage(
			"pages/users/list",
			{
				...nav,
				pageTitle: "Users",
				users: enrichedUsers,
				canCreateUser,
			},
			ctx.headers,
		);
	});
