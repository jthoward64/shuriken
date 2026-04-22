import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { GroupId, PrincipalId, UserId } from "#src/domain/ids.ts";
import { GROUPS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { GroupService } from "#src/services/group/index.ts";

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
	AclService | AppConfigService | CollectionService | GroupService | TemplateService
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
				collections,
			},
			ctx.headers,
		);
	});
