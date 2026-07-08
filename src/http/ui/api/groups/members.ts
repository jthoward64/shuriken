import { Effect } from "effect";
import {
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { GroupId, PrincipalId, UserId } from "#src/domain/ids.ts";
import { GROUPS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { AclService } from "#src/services/acl/index.ts";
import { GroupService } from "#src/services/group/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/groups/:principalId/members
// ---------------------------------------------------------------------------

export const groupsMembersHandler = (
	req: Request,
	ctx: HttpRequestContext,
	principalId: PrincipalId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	AclService | GroupService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const groupService = yield* GroupService;

		const { group, principal: principalRow } =
			yield* groupService.findByPrincipalId(principalId);

		const groupsVirtualPrivs = yield* acl.currentUserPrivileges(
			principal.principalId,
			GROUPS_VIRTUAL_RESOURCE_ID,
			"virtual",
		);
		if (!groupsVirtualPrivs.includes("DAV:write-properties")) {
			yield* acl.check(
				principal.principalId,
				principalRow.id as PrincipalId,
				"principal",
				"DAV:write-properties",
			);
		}

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		const userId = form.get("userId")?.toString() as UserId | undefined;
		if (!userId) {
			return new Response("Missing userId", { status: 400 });
		}
		const isMember = form
			.getAll("members")
			.some((v) => v.toString() === userId);

		if (isMember) {
			yield* groupService.addMember(group.id as GroupId, userId);
		} else {
			yield* groupService.removeMember(group.id as GroupId, userId);
		}

		const redirectTo = `/ui/groups/${principalId}`;
		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": redirectTo },
			});
		}
		return new Response(null, {
			status: 303,
			headers: { Location: redirectTo },
		});
	});
