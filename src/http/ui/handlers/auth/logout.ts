import { Effect, Option, Redacted } from "effect";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	clearSessionCookie,
	getCookie,
	SESSION_COOKIE,
} from "#src/http/cookie.ts";
import { HTTP_SEE_OTHER } from "#src/http/status.ts";
import { isSecureRequest } from "#src/http/ui/handlers/auth/helpers.ts";
import { SessionService } from "#src/services/session/service.ts";

// ---------------------------------------------------------------------------
// POST /ui/auth/logout — revoke the current session and clear the cookie.
// ---------------------------------------------------------------------------

export const logoutHandler = (
	_req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<Response, DatabaseError, SessionService> =>
	Effect.gen(function* () {
		const sessions = yield* SessionService;
		const tokenOpt = getCookie(ctx.headers, SESSION_COOKIE);
		if (Option.isSome(tokenOpt)) {
			yield* sessions.revoke(Redacted.make(tokenOpt.value));
		}
		return new Response(null, {
			status: HTTP_SEE_OTHER,
			headers: {
				Location: "/ui",
				"Set-Cookie": clearSessionCookie(isSecureRequest(ctx.url)),
			},
		});
	});
