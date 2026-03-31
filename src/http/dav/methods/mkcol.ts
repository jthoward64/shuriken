import { Effect } from "effect";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";

/** Handles MKCOL, MKCALENDAR, and MKADDRESSBOOK — stub */
export const mkcolHandler = (
	_path: ResolvedDavPath,
	_ctx: HttpRequestContext,
	_req: Request,
): Effect.Effect<Response, never> =>
	Effect.succeed(new Response(null, { status: 501 }));
