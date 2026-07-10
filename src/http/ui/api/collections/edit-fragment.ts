import { Effect, Option } from "effect";
import type { IrDeadProperties } from "#src/data/ir.ts";
import { resolveCalendarColor, toCssHex } from "#src/domain/calendar-color.ts";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import type { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import type { AuthenticatedPrincipal } from "#src/domain/types/dav.ts";
import {
	GROUPS_VIRTUAL_RESOURCE_ID,
	USERS_VIRTUAL_RESOURCE_ID,
} from "#src/domain/virtual-resources.ts";
import { buildSharePanelData } from "#src/http/ui/helpers/share-panel.ts";
import { CALENDAR_POPOVER_ID } from "#src/http/ui/view/pages/calendar/popover.tsx";
import type { CollectionEditPageProps } from "#src/http/ui/view/pages/collections.tsx";
import { AclService } from "#src/services/acl/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import type { PrincipalService } from "#src/services/principal/index.ts";
import { ShareLinkService } from "#src/services/share-link/service.ts";

// ---------------------------------------------------------------------------
// Shared by the GET edit-popover fragment and the feeds/add handler (which
// re-renders the same fragment after mutating), so both stay in sync.
// ---------------------------------------------------------------------------

export const loadCollectionEditFragmentProps = (
	principal: AuthenticatedPrincipal,
	collectionId: CollectionId,
): Effect.Effect<
	CollectionEditPageProps,
	DavError | DatabaseError,
	AclService | CollectionService | ShareLinkService | PrincipalService
> =>
	Effect.gen(function* () {
		const acl = yield* AclService;
		const collectionService = yield* CollectionService;
		const shareLinkSvc = yield* ShareLinkService;

		const collection = yield* collectionService.findById(collectionId);
		const isCalendar = collection.collectionType === "calendar";

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

		const feeds = isCalendar
			? yield* shareLinkSvc.listForUser(principal.userId).pipe(
					Effect.map((summaries) => {
						// (shareLinkId, calendarId) is a join-table primary key, so each
						// link contributes at most one row for this calendar — no dedup
						// needed.
						const member = summaries.flatMap(({ link, calendars }) =>
							calendars
								.filter((c) => c.calendarId === collection.id)
								.map((c) => ({
									feedId: link.id,
									displayName: link.displayName ?? "(untitled)",
									visibility: c.visibility,
								})),
						);
						const memberFeedIds = new Set(member.map((m) => m.feedId));
						const addable = summaries
							.filter(({ link }) => !memberFeedIds.has(link.id))
							.map(({ link }) => ({
								id: link.id,
								displayName: link.displayName ?? "(untitled)",
							}));
						return { member, addable };
					}),
				)
			: undefined;

		const sharePanel = yield* buildSharePanelData(
			principal.principalId,
			collection.id as CollectionId,
			"collection",
			isCalendar,
		).pipe(Effect.map(Option.getOrUndefined));

		return {
			id: collection.id,
			title: collection.displayName ?? collection.slug,
			slug: collection.slug,
			displayName: collection.displayName ?? "",
			description: collection.description ?? "",
			collectionType: collection.collectionType,
			// Owner details aren't rendered in the popover variant; avoid an
			// extra principal lookup here.
			ownerType: "user",
			ownerDisplayName: "",
			ownerPrincipalId: collection.ownerPrincipalId as PrincipalId,
			isCalendar,
			timezoneTzid: collection.timezoneTzid ?? "",
			calendarColor: toCssHex(
				resolveCalendarColor(
					collection.clientProperties as IrDeadProperties | null,
					collection.id,
				),
			),
			canDelete,
			sharePanel,
			variant: "popover",
			popoverId: CALENDAR_POPOVER_ID,
			feeds,
			isBirthdaysCollection: collection.autoManagedKind === "birthdays",
		};
	});
