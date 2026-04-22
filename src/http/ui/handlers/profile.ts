import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import type { AclService } from "#src/services/acl/index.ts";
import { UserService } from "#src/services/user/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/profile
// ---------------------------------------------------------------------------

export const profileHandler = (
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
		const userService = yield* UserService;

		const { user, principal: principalRow } = yield* userService.findById(
			principal.userId,
		);

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.mode,
		);

		const origin = ctx.url.origin;
		const davBase = `${origin}/dav/principals/${principalRow.id}`;

		return yield* renderPage(
			"pages/profile",
			{
				...nav,
				pageTitle: "My Profile",
				user,
				principal: principalRow,
				canEditSlug: false,
				showPasswordForm: config.auth.mode === "basic",
				principalUrl: `${davBase}/`,
				caldavUrl: `${davBase}/cal/`,
				carddavUrl: `${davBase}/card/`,
			},
			ctx.headers,
		);
	});
