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
	AclService | AppConfigService | PrincipalService | TemplateService
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

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.mode,
		);

		return yield* renderPage(
			"pages/collections/new",
			{
				...nav,
				pageTitle: "New Collection",
				ownerSlug: principalRow.slug,
				ownerDisplayName: principalRow.displayName ?? principalRow.slug,
				ownerType: "user",
				createUrl: `/ui/api/users/${principalRow.id}/collections/create`,
				backUrl: `/ui/users/${principalRow.id}`,
			},
			ctx.headers,
		);
	});
