import { Effect, Option } from "effect";
import { AppConfigService } from "#src/config.ts";
import type { IrDeadProperties } from "#src/data/ir.ts";
import { resolveCalendarColor, toCssHex } from "#src/domain/calendar-color.ts";
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
import { loadCollectionEditFragmentProps } from "#src/http/ui/api/collections/edit-fragment.ts";
import { buildAclPanelData } from "#src/http/ui/helpers/acl-panel.ts";
import { requireAuthenticated } from "#src/http/ui/helpers/auth-guard.ts";
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import { buildNavContext } from "#src/http/ui/helpers/nav-context.ts";
import { CollectionEditPage } from "#src/http/ui/view/pages/collections.tsx";
import { renderFragment, renderPage } from "#src/http/ui/view/render.tsx";
import { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { PrincipalService } from "#src/services/principal/index.ts";
import type { ShareLinkService } from "#src/services/share-link/service.ts";

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
	| ShareLinkService
> =>
	Effect.gen(function* () {
		const principal = yield* requireAuthenticated(ctx.auth);
		const config = yield* AppConfigService;
		const acl = yield* AclService;
		const collectionService = yield* CollectionService;
		const principalService = yield* PrincipalService;

		// The calendar sidebar's Edit trigger loads this as a popover fragment;
		// the shared helper does its own (cheaper) ACL check and owner-free
		// prop set, so short-circuit before the full-page-only work below.
		if (isHtmxRequest(ctx.headers)) {
			const props = yield* loadCollectionEditFragmentProps(
				principal,
				collectionId,
			);
			return yield* renderFragment(<CollectionEditPage {...props} />);
		}

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
				displayName: pwu.principal.displayName ?? pwu.principal.slug,
				type: "user" as const,
			})),
			Effect.catchTag("DavError", (e) =>
				e.status === HTTP_NOT_FOUND
					? principalService.findPrincipalById(ownerPrincipalId).pipe(
							Effect.map((p) => ({
								displayName: p.displayName ?? p.slug,
								type: "group" as const,
							})),
						)
					: Effect.fail(e),
			),
		);

		const calendarColor = toCssHex(
			resolveCalendarColor(
				collection.clientProperties as IrDeadProperties | null,
				collection.id,
			),
		);
		const title = collection.displayName ?? collection.slug;

		const nav = yield* buildNavContext(
			principal,
			ctx.url.pathname,
			config.auth.basicAuthEnabled,
		);

		const aclPanel = yield* buildAclPanelData(
			principal.principalId,
			collection.id as CollectionId,
			"collection",
		).pipe(Effect.map(Option.getOrUndefined));

		return yield* renderPage(
			<CollectionEditPage
				id={collection.id}
				title={title}
				slug={collection.slug}
				displayName={collection.displayName ?? ""}
				description={collection.description ?? ""}
				collectionType={collection.collectionType}
				ownerType={ownerResult.type}
				ownerDisplayName={ownerResult.displayName}
				ownerPrincipalId={ownerPrincipalId}
				isCalendar={collection.collectionType === "calendar"}
				timezoneTzid={collection.timezoneTzid ?? ""}
				calendarColor={calendarColor}
				canDelete={canDelete}
				aclPanel={aclPanel}
				isBirthdaysCollection={collection.autoManagedKind === "birthdays"}
			/>,
			{
				headers: ctx.headers,
				title,
				nav,
			},
		);
	});
