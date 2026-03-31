import { Effect } from "effect";
import { davError } from "#/domain/errors.ts";
import type { ResolvedDavPath } from "#/domain/types/path.ts";
import type { HttpRequestContext } from "#/http/context.ts";
import { HTTP_NOT_IMPLEMENTED } from "#/http/status.ts";

// ---------------------------------------------------------------------------
// PROPFIND handler — stub (RFC 4918 §9.1)
// ---------------------------------------------------------------------------

export const propfindHandler = (
	_path: ResolvedDavPath,
	_ctx: HttpRequestContext,
	_req: Request,
): Effect.Effect<Response, never> =>
	Effect.succeed(
		new Response(
			JSON.stringify(
				davError(HTTP_NOT_IMPLEMENTED, undefined, "PROPFIND not yet implemented"),
			),
			{ status: HTTP_NOT_IMPLEMENTED },
		),
	);
