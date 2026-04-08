import { Effect } from "effect";
import type { DavError } from "#src/domain/errors.ts";
import { notFound } from "#src/domain/errors.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";

// ---------------------------------------------------------------------------
// OPTIONS handler — advertises DAV capabilities and allowed methods
// ---------------------------------------------------------------------------

const DAV_CAPABILITIES = "1, 3, extended-mkcol, calendar-access, addressbook";
const ALLOWED_METHODS =
	"OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, MKCOL, REPORT, MKCALENDAR, MKADDRESSBOOK, ACL, COPY, MOVE";

export const optionsHandler = (
	path: ResolvedDavPath,
	_ctx: HttpRequestContext,
): Effect.Effect<Response, DavError> => {
	if (path.kind === "new-collection" || path.kind === "new-instance") {
		return Effect.fail(notFound());
	}
	return Effect.succeed(
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
};
