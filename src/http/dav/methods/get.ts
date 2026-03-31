import { Effect } from "effect";
import type { HttpRequestContext } from "#/http/context.ts";
import type { ResolvedDavPath } from "#/domain/types/path.ts";

export const getHandler = (
  _path: ResolvedDavPath,
  _ctx: HttpRequestContext,
): Effect.Effect<Response, never> =>
  Effect.succeed(new Response(null, { status: 501 }));
