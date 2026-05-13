import { Effect } from "effect";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";

// ---------------------------------------------------------------------------
// OPTIONS handler — advertises DAV capabilities and allowed methods.
//
// RFC 4918 §9.2 says OPTIONS MUST succeed on any URL, including non-existent
// ones. RFC 4918 §10.1 says the Allow header lists the methods supported on
// the specific resource — but in practice every CalDAV/CardDAV server
// (Apple CalendarServer, DAViCal, Radicale, Baikal, …) returns the full
// method list regardless of the resource. Clients use OPTIONS to learn what
// the server can do, not which methods will succeed on a specific URL;
// per-method success is gated by auth + ACL at request time. We follow that
// convention so clients that pre-check capabilities don't see false negatives.
// ---------------------------------------------------------------------------

const DAV_CAPABILITIES =
	"1, 3, access-control, extended-mkcol, calendar-access, addressbook, calendar-auto-schedule, calendar-no-timezone";
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
				// MS-Author-Via: DAV — legacy header expected by older IIS-derived
				// clients. Harmless to emit and required by some integration tests.
				"MS-Author-Via": "DAV",
			},
		}),
	);
