import { Effect } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import type { UserId } from "#src/domain/ids.ts";
import type { Slug } from "#src/domain/types/path.ts";
import { USERS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { AclService } from "#src/services/acl/index.ts";
import { UserService } from "#src/services/user/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/users/:slug/delete
// ---------------------------------------------------------------------------

export const usersDeleteHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	slug: Slug,
): Effect.Effect<Response, DavError | DatabaseError, AclService | UserService> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const userService = yield* UserService;

		const { user } = yield* userService.findBySlug(slug);

		yield* acl.check(
			principal.principalId,
			USERS_VIRTUAL_RESOURCE_ID,
			"virtual",
			"DAV:unbind",
		);

		yield* userService.delete(user.id as UserId);

		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": "/ui/users" },
			});
		}
		return new Response(null, {
			status: 303,
			headers: { Location: "/ui/users" },
		});
	});
