import { Effect } from "effect";
import {
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { isUuid } from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_BAD_REQUEST, HTTP_SEE_OTHER } from "#src/http/status.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { AppPasswordService } from "#src/services/app-password/service.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/profile/app-passwords/revoke — delete one app password.
// ---------------------------------------------------------------------------

export const appPasswordsRevokeHandler = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AppPasswordService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const svc = yield* AppPasswordService;

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});
		const id = form.get("id")?.toString() ?? "";
		if (!isUuid(id)) {
			return new Response("Invalid id", { status: HTTP_BAD_REQUEST });
		}

		yield* svc.revoke(principal.userId, id);

		const redirect = "/ui/profile/app-passwords";
		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": redirect },
			});
		}
		return new Response(null, {
			status: HTTP_SEE_OTHER,
			headers: { Location: redirect },
		});
	});
