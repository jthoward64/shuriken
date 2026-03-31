import { Effect } from "effect";
import { davError } from "#/domain/errors.ts";
import type { HttpRequestContext } from "#/http/context.ts";
import type { ResolvedDavPath } from "#/domain/types/path.ts";

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
      JSON.stringify(davError(501, undefined, "PROPFIND not yet implemented")),
      { status: 501 },
    ),
  );
