import { Effect } from "effect";

// ---------------------------------------------------------------------------
// Web UI — home page placeholder
// ---------------------------------------------------------------------------

const HTML = `<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8"><title>shuriken</title></head>
  <body>
    <h1>shuriken</h1>
    <p>CalDAV / CardDAV server — web UI coming soon.</p>
  </body>
</html>`;

export const indexHandler = (_req: Request): Effect.Effect<Response, never> =>
  Effect.succeed(
    new Response(HTML, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    }),
  );
