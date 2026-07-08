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
import { ProfilePage } from "#src/http/ui/view/pages/profile.tsx";
import { renderPage } from "#src/http/ui/view/render.tsx";
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
	AclService | AppConfigService | UserService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const userService = yield* UserService;

		const { user, principal: principalRow } = yield* userService.findById(
			principal.userId,
		);

		// OIDC-managed accounts have no local password — they authenticate DAV
		// clients with app passwords — so the change-password form is hidden for
		// them. (Still gated by the global basic-auth toggle.)
		const authSources = yield* userService.listAuthSources(principal.userId);
		const isOidcManaged = authSources.includes("oidc");

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		const davBase = `${ctx.url.origin}/dav/principals/${principalRow.id}`;

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
			<ProfilePage
				principalId={principalRow.id}
				slug={principalRow.slug}
				displayName={principalRow.displayName ?? ""}
				email={user.email}
				canEditSlug={false}
				showPasswordForm={config.auth.basicAuthEnabled && !isOidcManaged}
				showSignOut={config.auth.oidcEnabled}
				authSettingsUrl={authSettingsUrl}
				authSettingsLabel={authSettingsLabel}
				dav={{
					principal: `${davBase}/`,
					caldav: `${davBase}/cal/`,
					carddav: `${davBase}/card/`,
				}}
			/>,
			{ headers: ctx.headers, title: "My profile", nav },
		);
	});
