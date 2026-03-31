import { Effect } from "effect";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";

export const deleteHandler = (
	_path: ResolvedDavPath,
	_ctx: HttpRequestContext,
): Effect.Effect<Response, never> =>
	Effect.succeed(new Response(null, { status: 501 }));
