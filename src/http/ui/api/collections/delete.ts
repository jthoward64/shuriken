import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import {
	type DatabaseError,
	type DavError,
	InternalError,
	needPrivileges,
} from "#src/domain/errors.ts";
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
import { isAutoManagedCollection } from "#src/services/collection/read-only-guard.ts";
import type { CollectionRepository } from "#src/services/collection/repository.ts";
import { PrincipalService } from "#src/services/principal/index.ts";

// ---------------------------------------------------------------------------
// POST /ui/api/collections/:collectionId/delete
//
// When trash retention is disabled (AppConfigService.trash.retentionDays ===
// 0), the collection is hard-deleted immediately instead of soft-deleted —
// there is no trash bin to recover it from in that mode.
// ---------------------------------------------------------------------------

export const collectionsDeleteHandler = (
	req: Request,
	ctx: HttpRequestContext,
	collectionId: CollectionId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclService
	| AppConfigService
	| CollectionRepository
	| CollectionService
	| PrincipalService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const acl = yield* AclService;
		const collectionService = yield* CollectionService;
		const principalService = yield* PrincipalService;
		const config = yield* AppConfigService;

		const collection = yield* collectionService.findById(collectionId);
		const ownerPrincipalId = collection.ownerPrincipalId as PrincipalId;

		// Auto-managed collections (e.g. birthdays) aren't user-deletable: the
		// server owns their lifecycle, and deleting one leaves no self-service
		// way to get it back — mirrors the DAV DELETE guard in
		// src/http/dav/methods/delete.ts.
		if (yield* isAutoManagedCollection(collectionId)) {
			return yield* Effect.fail(
				needPrivileges("collection is server-managed and cannot be deleted"),
			);
		}

		const [collPrivs, usersPrivs, groupsPrivs] = yield* Effect.all([
			acl.currentUserPrivileges(
				principal.principalId,
				collection.id as CollectionId,
				"collection",
			),
			acl.currentUserPrivileges(
				principal.principalId,
				USERS_VIRTUAL_RESOURCE_ID,
				"virtual",
			),
			acl.currentUserPrivileges(
				principal.principalId,
				GROUPS_VIRTUAL_RESOURCE_ID,
				"virtual",
			),
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

		const form = yield* Effect.tryPromise({
			try: () => req.formData(),
			catch: (e) => new InternalError({ cause: e }),
		});

		// Resolve owner before deleting so we can redirect after
		if (config.trash.retentionDays === 0) {
			yield* collectionService.hardDelete(collectionId);
		} else {
			yield* collectionService.delete(collectionId);
		}

		// The calendar sidebar's Edit popover passes returnTo=/ui/calendar so it
		// lands back on the calendar view instead of the owner's page.
		const returnTo = form.get("returnTo")?.toString();
		const redirectTo = returnTo
			? Effect.succeed(returnTo)
			: principalService.findById(ownerPrincipalId).pipe(
					Effect.map(() => `/ui/users/${ownerPrincipalId}`),
					Effect.catchTag("DavError", (e) =>
						e.status === HTTP_NOT_FOUND
							? Effect.succeed(`/ui/groups/${ownerPrincipalId}`)
							: Effect.fail(e),
					),
				);

		const destination = yield* redirectTo;

		if (isHtmxRequest(ctx.headers)) {
			return new Response(null, {
				status: 200,
				headers: { "HX-Redirect": destination },
			});
		}
		return new Response(null, {
			status: 303,
			headers: { Location: destination },
		});
	});
