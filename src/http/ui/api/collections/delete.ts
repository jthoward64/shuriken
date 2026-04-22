import { Effect } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import {
	GROUPS_VIRTUAL_RESOURCE_ID,
	USERS_VIRTUAL_RESOURCE_ID,
} from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_NOT_FOUND } from "#src/http/status.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { PrincipalService } from "#src/services/principal/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/collections/:collectionId/delete
// ---------------------------------------------------------------------------

export const collectionsDeleteHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	collectionId: CollectionId,
): Effect.Effect<
	Response,
	DavError | DatabaseError,
	AclService | CollectionService | PrincipalService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const collectionService = yield* CollectionService;
		const principalService = yield* PrincipalService;

		const collection = yield* collectionService.findById(collectionId);
		const ownerPrincipalId = collection.ownerPrincipalId as PrincipalId;

		const [collPrivs, usersPrivs, groupsPrivs] = yield* Effect.all([
			acl.currentUserPrivileges(principal.principalId, collection.id as CollectionId, "collection"),
			acl.currentUserPrivileges(principal.principalId, USERS_VIRTUAL_RESOURCE_ID, "virtual"),
			acl.currentUserPrivileges(principal.principalId, GROUPS_VIRTUAL_RESOURCE_ID, "virtual"),
		]);

		const canDelete =
			collPrivs.includes("DAV:unbind") ||
			usersPrivs.includes("DAV:unbind") ||
			groupsPrivs.includes("DAV:unbind");

		if (!canDelete) {
			yield* acl.check(
				principal.principalId,
				collection.id as CollectionId,
				"collection",
				"DAV:unbind",
			);
		}

		// Resolve owner before deleting so we can redirect after
		const ownerResult = yield* principalService.findById(ownerPrincipalId).pipe(
			Effect.map((pwu) => ({
				slug: pwu.principal.slug,
				type: "user" as const,
			})),
			Effect.catchTag("DavError", (e) =>
				e.status === HTTP_NOT_FOUND
					? principalService.findPrincipalById(ownerPrincipalId).pipe(
							Effect.map((p) => ({
								slug: p.slug,
								type: "group" as const,
							})),
						)
					: Effect.fail(e),
			),
		);

		yield* collectionService.delete(collectionId);

		const redirectTo =
			ownerResult.type === "user"
				? `/ui/users/${ownerResult.slug}`
				: `/ui/groups/${ownerResult.slug}`;

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
