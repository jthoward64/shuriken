import { Effect } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import { methodNotAllowed, notFound, unauthorized } from "#src/domain/errors.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import { GROUPS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_NO_CONTENT } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { GroupService } from "#src/services/group/index.ts";

/** Handles DELETE /dav/groups/:slug — soft-deletes a group. */
export const groupDeleteHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	AclService | GroupService
> =>
	Effect.gen(function* () {
		if (path.kind === "newGroup") {
			return yield* notFound();
		}
		if (path.kind !== "group") {
			return yield* methodNotAllowed();
		}

		if (ctx.auth._tag !== "Authenticated") {
			return yield* unauthorized();
		}
		const requester = ctx.auth.principal;
		const acl = yield* AclService;

		yield* acl
			.check(requester.principalId, path.principalId, "principal", "DAV:unbind")
			.pipe(
				Effect.catchTag("DavError", () =>
					acl.check(
						requester.principalId,
						GROUPS_VIRTUAL_RESOURCE_ID,
						"virtual",
						"DAV:unbind",
					),
				),
			);

		const groupSvc = yield* GroupService;
		yield* groupSvc.delete(path.groupId);

		return new Response(null, { status: HTTP_NO_CONTENT });
	});
