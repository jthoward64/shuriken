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
import { CollectionNewPage } from "#src/http/ui/view/pages/collections.tsx";
import { renderPage } from "#src/http/ui/view/render.tsx";
import { AclService } from "#src/services/acl/index.ts";
import { GroupService } from "#src/services/group/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/groups/:principalId/collections/new
// ---------------------------------------------------------------------------

export const groupsCollectionsNewHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	principalId: PrincipalId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | GroupService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const acl = yield* AclService;
		const groupService = yield* GroupService;

		const { principal: principalRow } =
			yield* groupService.findByPrincipalId(principalId);

		yield* acl.check(
			principal.principalId,
			GROUPS_VIRTUAL_RESOURCE_ID,
			"virtual",
			"DAV:bind",
		);

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		return yield* renderPage(
			<CollectionNewPage
				ownerType="group"
				ownerDisplayName={principalRow.displayName ?? principalRow.slug}
				createUrl={`/ui/api/groups/${principalRow.id}/collections/create`}
				backUrl={`/ui/groups/${principalRow.id}`}
			/>,
			{ headers: ctx.headers, title: "New collection", nav },
		);
	});
