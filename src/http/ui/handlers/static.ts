import { Effect } from "effect";

// ---------------------------------------------------------------------------
// Web UI — static asset serving (placeholder)
// ---------------------------------------------------------------------------

export const staticHandler = (_req: Request): Effect.Effect<Response, never> =>
  Effect.succeed(new Response(null, { status: 404 }));
