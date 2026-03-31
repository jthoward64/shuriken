import { Effect } from "effect";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";

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
				// biome-ignore lint/style/useNamingConvention: HTTP header names are uppercase
				DAV: DAV_CAPABILITIES,
				// biome-ignore lint/style/useNamingConvention: HTTP header names are uppercase
				Allow: ALLOWED_METHODS,
				"Content-Length": "0",
				"MS-Author-Via": "DAV",
			},
		}),
	);
