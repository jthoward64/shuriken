import { Effect } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { forbidden, methodNotAllowed, notFound } from "#src/domain/errors.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import { GROUPS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_NO_CONTENT } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { GroupService } from "#src/services/group/index.ts";

/** Handles PUT /dav/groups/:slug/members/:userSlug — adds an existing user to a group. */
export const groupMemberPutHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	AclService | GroupService
> =>
	Effect.gen(function* () {
		if (path.kind === "groupMemberNonExistent") {
			return yield* notFound();
		}
		if (path.kind !== "groupMember") {
			return yield* methodNotAllowed();
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* forbidden("DAV:need-privileges");
		}
		const requester = ctx.auth.principal;
		const acl = yield* AclService;

		yield* acl
			.check(requester.principalId, path.principalId, "principal", "DAV:bind")
			.pipe(
				Effect.catchTag("DavError", () =>
					acl.check(
						requester.principalId,
						GROUPS_VIRTUAL_RESOURCE_ID,
						"virtual",
						"DAV:bind",
					),
				),
			);

		const groupSvc = yield* GroupService;
		yield* groupSvc.addMember(path.groupId, path.memberUserId);

		return new Response(null, { status: HTTP_NO_CONTENT });
	});
