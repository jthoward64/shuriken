import { Effect } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import type { PrincipalId, UserId } from "#src/domain/ids.ts";
import { USERS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { AclService } from "#src/services/acl/index.ts";
import { PrincipalService } from "#src/services/principal/index.ts";
import { UserService } from "#src/services/user/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/users/:principalId/delete
// ---------------------------------------------------------------------------

export const usersDeleteHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	principalId: PrincipalId,
): Effect.Effect<Response, DavError | DatabaseError, AclService | PrincipalService | UserService> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const principalService = yield* PrincipalService;
		const userService = yield* UserService;

		const { user } = yield* principalService.findById(principalId);

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
