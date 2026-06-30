import { Effect, Option } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { AuthenticatedPrincipal } from "#src/domain/types/dav.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import type { AclService } from "#src/services/acl/index.ts";
import { AppPasswordService } from "#src/services/app-password/service.ts";

// ---------------------------------------------------------------------------
// /ui/profile/app-passwords — manage per-device DAV credentials.
//
// `renderAppPasswordsPage` is shared by the GET page and the create POST so a
// freshly generated secret can be shown exactly once (passed as `generated`).
// ---------------------------------------------------------------------------

export interface GeneratedSecret {
	readonly username: string;
	readonly password: string;
}

export const renderAppPasswordsPage = (
	ctx: HttpRequestContext,
	principal: AuthenticatedPrincipal,
	generated: Option.Option<GeneratedSecret>,
): Effect.Effect<
	Response,
	DatabaseError | InternalError,
	AclService | AppConfigService | AppPasswordService | TemplateService
> =>
	Effect.gen(function* () {
		const config = yield* AppConfigService;
		const svc = yield* AppPasswordService;
		const rows = yield* svc.list(principal.userId);

		const nav = yield* buildNavContext(
			principal,
			"/ui/profile",
			config.auth.basicAuthEnabled,
		);

		return yield* renderPage(
			"pages/profile/app-passwords",
			{
				...nav,
				pageTitle: "App passwords",
				appPasswords: rows.map((r) => ({
					id: r.id,
					username: r.username,
					label: r.label,
					created: r.createdAt.toString(),
					lastUsed: r.lastUsedAt === null ? null : r.lastUsedAt.toString(),
				})),
				generated: Option.getOrNull(generated),
			},
			ctx.headers,
		);
	});

export const appPasswordsPageHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService | AppPasswordService | TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		return yield* renderAppPasswordsPage(ctx, principal, Option.none());
	});
