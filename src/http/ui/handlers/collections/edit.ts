import { Effect } from "effect";
import { AppConfigService } from "#src/config.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import {
	GROUPS_VIRTUAL_RESOURCE_ID,
	USERS_VIRTUAL_RESOURCE_ID,
} from "#src/domain/virtual-resources.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_NOT_FOUND } from "#src/http/status.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { renderPage } from "#src/http/ui/helpers/render-page.ts";
import type { TemplateService } from "#src/http/ui/template/index.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { PrincipalService } from "#src/services/principal/index.ts";

// ---------------------------------------------------------------------------
// GET /ui/collections/:collectionId
// ---------------------------------------------------------------------------

export const collectionsEditHandler = (
	_req: Request,
	ctx: HttpRequestContext,
	collectionId: CollectionId,
): Effect.Effect<
	Response,
	DavError | DatabaseError | InternalError,
	| AclService
	| AppConfigService
	| CollectionService
	| PrincipalService
	| TemplateService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const acl = yield* AclService;
		const collectionService = yield* CollectionService;
		const principalService = yield* PrincipalService;

		const collection = yield* collectionService.findById(collectionId);
		const ownerPrincipalId = collection.ownerPrincipalId as PrincipalId;

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

		const isAdmin =
			usersPrivs.includes("DAV:write-properties") ||
			groupsPrivs.includes("DAV:write-properties");

		if (!collPrivs.includes("DAV:write-properties") && !isAdmin) {
			yield* acl.check(
				principal.principalId,
				collection.id as CollectionId,
				"collection",
				"DAV:write-properties",
			);
		}

		const canDelete =
			collPrivs.includes("DAV:unbind") ||
			usersPrivs.includes("DAV:unbind") ||
			groupsPrivs.includes("DAV:unbind");

		// Resolve owner: try user principal first, fall back to group
		const ownerResult = yield* principalService.findById(ownerPrincipalId).pipe(
			Effect.map((pwu) => ({
				slug: pwu.principal.slug,
				displayName: pwu.principal.displayName ?? pwu.principal.slug,
				type: "user" as const,
			})),
			Effect.catchTag("DavError", (e) =>
				e.status === HTTP_NOT_FOUND
					? principalService.findPrincipalById(ownerPrincipalId).pipe(
							Effect.map((p) => ({
								slug: p.slug,
								displayName: p.displayName ?? p.slug,
								type: "group" as const,
							})),
						)
					: Effect.fail(e),
			),
		);

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.mode,
		);

		return yield* renderPage(
			"pages/collections/edit",
			{
				...nav,
				pageTitle: collection.displayName ?? collection.slug,
				collection,
				ownerPrincipalId,
				ownerDisplayName: ownerResult.displayName,
				ownerType: ownerResult.type,
				isCalendar: collection.collectionType === "calendar",
				canDelete,
			},
			ctx.headers,
		);
	});
