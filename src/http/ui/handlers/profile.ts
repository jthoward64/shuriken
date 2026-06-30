import { Effect, Option } from "effect";
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
			config.auth.basicAuthEnabled,
		);

		const origin = ctx.url.origin;
		const davBase = `${origin}/dav/principals/${principalRow.id}`;

		// External auth-settings link (e.g. SSO portal). Substitute `{email}`,
		// `{slug}`, and `{userId}` placeholders so the same template URL works
		// for every user. Encoded so a literal `{}` segment can't break the
		// surrounding URL via injection of `?` or `#`.
		const authSettingsUrl = Option.match(config.auth.authSettingsUrl, {
			onNone: () => undefined,
			onSome: (raw) =>
				raw
					.replace(/\{email\}/g, encodeURIComponent(user.email))
					.replace(/\{slug\}/g, encodeURIComponent(principalRow.slug))
					.replace(/\{userId\}/g, encodeURIComponent(user.id)),
		});
		const authSettingsLabel = Option.getOrElse(
			config.auth.authSettingsLabel,
			() => "Manage account",
		);

		return yield* renderPage(
			"pages/profile",
			{
				...nav,
				pageTitle: "My Profile",
				user,
				principal: principalRow,
				canEditSlug: false,
				showPasswordForm: config.auth.basicAuthEnabled,
				showSignOut: config.auth.oidcEnabled,
				authSettingsUrl,
				authSettingsLabel,
				principalUrl: `${davBase}/`,
				caldavUrl: `${davBase}/cal/`,
				carddavUrl: `${davBase}/card/`,
			},
			ctx.headers,
		);
	});
