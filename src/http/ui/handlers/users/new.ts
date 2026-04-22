import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { USERS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import { AclService } from "#src/services/acl/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/users/new
// ---------------------------------------------------------------------------

export const usersNewHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const acl = yield* AclService;

		yield* acl.check(
			principal.principalId,
			USERS_VIRTUAL_RESOURCE_ID,
			"virtual",
			"DAV:bind",
		);

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.mode,
		);

		return yield* renderPage(
			"pages/users/new",
			{
				...nav,
				pageTitle: "New User",
				showPasswordForm: config.auth.mode === "basic",
			},
			ctx.headers,
		);
	});
