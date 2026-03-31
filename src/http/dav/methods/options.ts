import { Effect } from "effect";
import type { HttpRequestContext } from "#/http/context.ts";
import type { ResolvedDavPath } from "#/domain/types/path.ts";

// ---------------------------------------------------------------------------
// OPTIONS handler — advertises DAV capabilities and allowed methods
// ---------------------------------------------------------------------------

const DAV_CAPABILITIES = "1, 3, extended-mkcol, calendar-access, addressbook";
const ALLOWED_METHODS =
  "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, REPORT, MKCALENDAR, MKADDRESSBOOK, ACL";

export const optionsHandler = (
  _path: ResolvedDavPath,
  _ctx: HttpRequestContext,
): Effect.Effect<Response, never> =>
  Effect.succeed(
    new Response(null, {
      status: 200,
      headers: {
        "DAV": DAV_CAPABILITIES,
        "Allow": ALLOWED_METHODS,
        "Content-Length": "0",
        "MS-Author-Via": "DAV",
      },
    }),
  );
