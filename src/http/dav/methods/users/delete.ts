import { Effect } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import {
	methodNotAllowed,
	notFound,
	unauthorized,
} from "#src/domain/errors.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import { USERS_VIRTUAL_RESOURCE_ID } from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_NO_CONTENT } from "#src/http/status.ts";
import { AclService } from "#src/services/acl/index.ts";
import { UserService } from "#src/services/user/index.ts";

/** Handles DELETE /dav/users/:slug — soft-deletes a user. */
export const userDeleteHandler = (
	path: ResolvedDavPath,
	ctx: HttpRequestContext,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	AclService | UserService
> =>
	Effect.gen(function* () {
		if (path.kind === "newUser") {
			return yield* notFound();
		}
		if (path.kind !== "user") {
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
						USERS_VIRTUAL_RESOURCE_ID,
						"virtual",
						"DAV:unbind",
					),
				),
			);

		const userSvc = yield* UserService;
		yield* userSvc.delete(path.userId);

		return new Response(null, { status: HTTP_NO_CONTENT });
	});
