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
import { ComponentGalleryPage } from "#src/http/ui/view/pages/dev/components.tsx";
import { AssetTags, FORM_ASSETS } from "#src/http/ui/view/shell/assets.tsx";
import { renderPage } from "#src/http/ui/view/shell/render.tsx";
import type { AclService } from "#src/services/acl/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/dev/components - the component gallery.
//
// Authenticated but not otherwise gated: it renders only static demo data and
// exists to be opened in a real browser against a real stylesheet, which is
// the whole point of having it.
// ---------------------------------------------------------------------------

export const componentGalleryHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | AppConfigService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		return yield* renderPage(<ComponentGalleryPage />, {
			headers: ctx.headers,
			title: "Components",
			nav,
			preload: FORM_ASSETS,
			extraHead: <AssetTags assets={FORM_ASSETS} />,
		});
	});
