import { Effect } from "effect";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";

// ---------------------------------------------------------------------------
// OPTIONS handler — advertises DAV capabilities and allowed methods
// RFC 4918 §9.2: OPTIONS MUST succeed on any URL, including non-existent ones.
// ---------------------------------------------------------------------------

const DAV_CAPABILITIES =
	"1, 3, extended-mkcol, calendar-access, addressbook, calendar-auto-schedule, calendar-no-timezone";
const ALLOWED_METHODS =
	"OPTIONS, GET, HEAD, POST, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, REPORT, MKCALENDAR, MKADDRESSBOOK, ACL, COPY, MOVE";

export const optionsHandler = (
	_path: ResolvedDavPath,
	_ctx: HttpRequestContext,
): Effect.Effect<Response, never> =>
	Effect.succeed(
		new Response(null, {
			status: 200,
			headers: {
				DAV: DAV_CAPABILITIES,
				Allow: ALLOWED_METHODS,
				"Content-Length": "0",
				"MS-Author-Via": "DAV",
			},
		}),
	);
