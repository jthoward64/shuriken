import { Effect } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import type { GroupId, PrincipalId } from "#src/domain/ids.ts";
import { GROUPS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { AclService } from "#src/services/acl/index.ts";
import { GroupService } from "#src/services/group/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/groups/:principalId/delete
// ---------------------------------------------------------------------------

export const groupsDeleteHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	principalId: PrincipalId,
): Effect.Effect<Response, DavError | DatabaseError, AclService | GroupService> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const groupService = yield* GroupService;

		const { group } = yield* groupService.findByPrincipalId(principalId);

		yield* acl.check(
			principal.principalId,
			GROUPS_VIRTUAL_RESOURCE_ID,
			"virtual",
			"DAV:unbind",
		);

		yield* groupService.delete(group.id as GroupId);

		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": "/ui/groups" },
			});
		}
		return new Response(null, {
			status: 303,
			headers: { Location: "/ui/groups" },
		});
	});
