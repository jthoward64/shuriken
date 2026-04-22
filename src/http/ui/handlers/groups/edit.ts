import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { GroupId, PrincipalId, UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import { GROUPS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import { AclService } from "#src/services/acl/index.ts";
import { GroupService } from "#src/services/group/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/groups/:slug
// ---------------------------------------------------------------------------

export const groupsEditHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	slug: Slug,
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

		const { group, principal: principalRow } =
			yield* groupService.findBySlug(slug);

		yield* acl.check(
			principal.principalId,
			principalRow.id as PrincipalId,
			"principal",
			"DAV:write-properties",
		);

		const [members, groupsPrivs] = yield* Effect.all([
			groupService.listMembers(group.id as GroupId),
			acl.currentUserPrivileges(
				principal.principalId,
				GROUPS_VIRTUAL_RESOURCE_ID,
				"virtual",
			),
		]);

		const canDelete = groupsPrivs.includes("DAV:unbind");

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.mode,
		);

		return yield* renderPage(
			"pages/groups/edit",
			{
				...nav,
				pageTitle: principalRow.displayName ?? principalRow.slug,
				group,
				principal: principalRow,
				members: members.map((m) => ({
					user: m.user,
					principal: m.principal,
					id: m.user.id as UserId,
				})),
				canDelete,
			},
			ctx.headers,
		);
	});
