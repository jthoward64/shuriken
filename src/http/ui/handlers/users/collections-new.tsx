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
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { CollectionNewPage } from "#src/http/ui/view/pages/collections.tsx";
import { renderFragment, renderPage } from "#src/http/ui/view/render.tsx";
import { AclService } from "#src/services/acl/index.ts";
import { PrincipalService } from "#src/services/principal/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/users/:principalId/collections/new
// ---------------------------------------------------------------------------

export const usersCollectionsNewHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	principalId: PrincipalId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | PrincipalService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const acl = yield* AclService;
		const principalService = yield* PrincipalService;

		const { user, principal: principalRow } =
			yield* principalService.findById(principalId);

		const isSelf = user.id === principal.userId;
		if (!isSelf) {
			yield* acl.check(
				principal.principalId,
				USERS_VIRTUAL_RESOURCE_ID,
				"virtual",
				"DAV:bind",
			);
		}

		const createUrl = `/ui/api/users/${principalRow.id}/collections/create`;

		// HTMX = the Add-calendar → Create trigger: return the popover fragment.
		if (isHtmxRequest(ctx.headers)) {
			return yield* renderFragment(
				<CollectionNewPage
					ownerType="user"
					ownerDisplayName={principalRow.displayName ?? principalRow.slug}
					createUrl={createUrl}
					backUrl={`/ui/users/${principalRow.id}`}
					variant="popover"
				/>,
			);
		}

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		return yield* renderPage(
			<CollectionNewPage
				ownerType="user"
				ownerDisplayName={principalRow.displayName ?? principalRow.slug}
				createUrl={createUrl}
				backUrl={`/ui/users/${principalRow.id}`}
			/>,
			{ headers: ctx.headers, title: "New collection", nav },
		);
	});
