import { Effect } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { EmailCredentialService } from "#src/services/email-credential/service.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/profile/email-credentials/clear
// ---------------------------------------------------------------------------

export const emailCredentialsClearHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	EmailCredentialService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const svc = yield* EmailCredentialService;
		yield* svc.clearForUser(principal.userId);
		const redirect = "/ui/profile/email-credentials";
		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": redirect },
			});
		}
		return new Response(null, { status: 303, headers: { Location: redirect } });
	});
