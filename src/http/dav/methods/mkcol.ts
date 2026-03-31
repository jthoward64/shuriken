import { Effect } from "effect";
import type { HttpRequestContext } from "#/http/context.ts";
import type { ResolvedDavPath } from "#/domain/types/path.ts";

/** Handles MKCOL, MKCALENDAR, and MKADDRESSBOOK — stub */
export const mkcolHandler = (
	_path: ResolvedDavPath,
	_ctx: HttpRequestContext,
	_req: Request,
): Effect.Effect<Response, never> =>
	Effect.succeed(new Response(null, { status: 501 }));
