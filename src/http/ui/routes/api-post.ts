import { type Effect, Option } from "effect";
import {
	CollectionId,
	InstanceId,
	isUuid,
	PrincipalId,
	type UuidString,
	VirtualResourceId,
} from "#src/domain/ids.ts";
import { aclCollapseHandler } from "#src/http/ui/api/acl/collapse.tsx";
import { aclGrantHandler } from "#src/http/ui/api/acl/grant.tsx";
import { aclRevokeHandler } from "#src/http/ui/api/acl/revoke.tsx";
import { aclSetTierHandler } from "#src/http/ui/api/acl/set-tier.tsx";
import {
	eventCreateHandler,
	eventDeleteHandler,
	eventUpdateHandler,
} from "#src/http/ui/api/calendar/event-write.ts";
import { calendarImportHandler } from "#src/http/ui/api/calendar/import.tsx";
import { collectionsDeleteHandler } from "#src/http/ui/api/collections/delete.ts";
import { collectionsFeedsAddHandler } from "#src/http/ui/api/collections/feeds-add.tsx";
import { collectionsMoveHandler } from "#src/http/ui/api/collections/move.ts";
import { collectionsRegenerateBirthdaysHandler } from "#src/http/ui/api/collections/regenerate-birthdays.ts";
import { collectionsReorderHandler } from "#src/http/ui/api/collections/reorder.ts";
import { collectionsUpdateHandler } from "#src/http/ui/api/collections/update.ts";
import { contactsBulkClearPhotoHandler } from "#src/http/ui/api/contacts/bulk-clear-photo.tsx";
import { contactsBulkDeleteHandler } from "#src/http/ui/api/contacts/bulk-delete.tsx";
import { contactsBulkDownloadHandler } from "#src/http/ui/api/contacts/bulk-download.tsx";
import { contactsCleanupFixHandler } from "#src/http/ui/api/contacts/cleanup-fix.tsx";
import { contactsCleanupFixAllHandler } from "#src/http/ui/api/contacts/cleanup-fix-all.tsx";
import { contactsCreateHandler } from "#src/http/ui/api/contacts/create.ts";
import { contactsDeleteHandler } from "#src/http/ui/api/contacts/delete.ts";
import { contactsExportStartHandler } from "#src/http/ui/api/contacts/export-start.tsx";
import { contactsImportHandler } from "#src/http/ui/api/contacts/import.tsx";
import { contactsMergeExecuteHandler } from "#src/http/ui/api/contacts/merge.tsx";
import { contactsUpdateHandler } from "#src/http/ui/api/contacts/update.ts";
import { feedsCreateHandler } from "#src/http/ui/api/feeds/create.ts";
import { feedsDeleteHandler } from "#src/http/ui/api/feeds/delete.ts";
import { feedsRegenerateHandler } from "#src/http/ui/api/feeds/regenerate.ts";
import { feedsUpdateHandler } from "#src/http/ui/api/feeds/update.ts";
import { groupsCreateHandler } from "#src/http/ui/api/groups/create.tsx";
import { groupsCollectionsCreateHandler } from "#src/http/ui/api/groups/create-collection.tsx";
import { groupsDeleteHandler } from "#src/http/ui/api/groups/delete.ts";
import { groupsMembersHandler } from "#src/http/ui/api/groups/members.ts";
import { groupsUpdateHandler } from "#src/http/ui/api/groups/update.ts";
import { appPasswordsCreateHandler } from "#src/http/ui/api/profile/app-passwords-create.ts";
import { appPasswordsRevokeHandler } from "#src/http/ui/api/profile/app-passwords-revoke.ts";
import { emailCredentialsClearHandler } from "#src/http/ui/api/profile/email-credentials-clear.ts";
import { emailCredentialsSaveHandler } from "#src/http/ui/api/profile/email-credentials-save.ts";
import { subscriptionsCreateHandler } from "#src/http/ui/api/subscriptions/create.tsx";
import { subscriptionsDeleteHandler } from "#src/http/ui/api/subscriptions/delete.ts";
import {
	taskCreateHandler,
	taskDeleteHandler,
	taskToggleHandler,
	taskUpdateHandler,
} from "#src/http/ui/api/tasks/task-write.ts";
import { trashPurgeCollectionHandler } from "#src/http/ui/api/trash/purge-collection.ts";
import { trashPurgeInstanceHandler } from "#src/http/ui/api/trash/purge-instance.ts";
import { trashRestoreCollectionHandler } from "#src/http/ui/api/trash/restore-collection.ts";
import { trashRestoreInstanceHandler } from "#src/http/ui/api/trash/restore-instance.ts";
import { usersCreateHandler } from "#src/http/ui/api/users/create.tsx";
import { usersCollectionsCreateHandler } from "#src/http/ui/api/users/create-collection.tsx";
import { usersDeleteHandler } from "#src/http/ui/api/users/delete.ts";
import { usersSetPasswordHandler } from "#src/http/ui/api/users/set-password.tsx";
import { usersUpdateHandler } from "#src/http/ui/api/users/update.tsx";
import { addressbookParam, isApiPost } from "#src/http/ui/routes/params.ts";
import type {
	UiError,
	UiRoute,
	UiServices,
} from "#src/http/ui/routes/types.ts";

// ---------------------------------------------------------------------------
// API routes (POST)
// ---------------------------------------------------------------------------

const ACL_RESOURCE_KINDS = [
	"principal",
	"collection",
	"instance",
	"virtual",
] as const;

type AclResourceKind = (typeof ACL_RESOURCE_KINDS)[number];

// The ACL resource kind named by a path segment, if it names one at all
const aclResourceKind = (
	seg: string | undefined,
): Option.Option<AclResourceKind> => {
	const kind = ACL_RESOURCE_KINDS.find((candidate) => candidate === seg);
	return kind === undefined ? Option.none() : Option.some(kind);
};

// The typed id an ACL grant applies to, branded for its resource kind
const aclResourceId = (kind: AclResourceKind, id: UuidString) => {
	if (kind === "principal") {
		return PrincipalId(id);
	}
	if (kind === "collection") {
		return CollectionId(id);
	}
	if (kind === "instance") {
		return InstanceId(id);
	}
	return VirtualResourceId(id);
};

const matchAclPostRoutes = (route: UiRoute) => {
	const { req, ctx, segments } = route;
	const [, , seg2, seg3, seg4] = segments;
	if (!(isApiPost(route, "acl") && seg3 && isUuid(seg3))) {
		return Option.none();
	}
	return Option.flatMap(aclResourceKind(seg2), (kind) => {
		const resourceId = aclResourceId(kind, seg3);
		if (seg4 === "grant") {
			return Option.some(aclGrantHandler(req, ctx, kind, resourceId));
		}
		if (seg4 === "revoke") {
			return Option.some(aclRevokeHandler(req, ctx, kind, resourceId));
		}
		if (seg4 === "set-tier") {
			return Option.some(aclSetTierHandler(req, ctx, kind, resourceId));
		}
		if (seg4 === "collapse") {
			return Option.some(aclCollapseHandler(req, ctx, kind, resourceId));
		}
		return Option.none();
	});
};

const matchCollectionPostRoutes = (route: UiRoute) => {
	const { req, ctx, segments } = route;
	const [, , seg2, seg3, seg4] = segments;
	if (!isApiPost(route, "collections")) {
		return Option.none();
	}
	if (seg2 === "reorder" && !seg3) {
		return Option.some(collectionsReorderHandler(req, ctx));
	}
	if (!(seg2 && isUuid(seg2))) {
		return Option.none();
	}
	const collectionId = CollectionId(seg2);
	if (seg3 === "update" && !seg4) {
		return Option.some(collectionsUpdateHandler(req, ctx, collectionId));
	}
	if (seg3 === "delete" && !seg4) {
		return Option.some(collectionsDeleteHandler(req, ctx, collectionId));
	}
	if (seg3 === "move" && (seg4 === "up" || seg4 === "down")) {
		return Option.some(collectionsMoveHandler(req, ctx, collectionId, seg4));
	}
	if (seg3 === "feeds" && seg4 === "add") {
		return Option.some(collectionsFeedsAddHandler(req, ctx, collectionId));
	}
	if (seg3 === "regenerate-birthdays" && !seg4) {
		return Option.some(
			collectionsRegenerateBirthdaysHandler(req, ctx, collectionId),
		);
	}
	return Option.none();
};

const matchUserPostRoutes = (route: UiRoute) => {
	const { req, ctx, segments } = route;
	const [, , seg2, seg3, seg4] = segments;
	if (!isApiPost(route, "users")) {
		return Option.none();
	}
	if (seg2 === "create" && !seg3) {
		return Option.some(usersCreateHandler(req, ctx));
	}
	if (!(seg2 && isUuid(seg2))) {
		return Option.none();
	}
	const principalId = PrincipalId(seg2);
	if (seg3 === "update" && !seg4) {
		return Option.some(usersUpdateHandler(req, ctx, principalId));
	}
	if (seg3 === "delete" && !seg4) {
		return Option.some(usersDeleteHandler(req, ctx, principalId));
	}
	if (seg3 === "set-password" && !seg4) {
		return Option.some(usersSetPasswordHandler(req, ctx, principalId));
	}
	if (seg3 === "collections" && seg4 === "create") {
		return Option.some(usersCollectionsCreateHandler(req, ctx, principalId));
	}
	return Option.none();
};

// Calendar bulk import plus the event mutations under a calendar
const matchCalendarPostRoutes = (route: UiRoute) => {
	const { req, ctx, segments } = route;
	const [, , seg2, seg3, seg4, seg5] = segments;
	if (!(isApiPost(route, "calendar") && seg2 && isUuid(seg2))) {
		return Option.none();
	}
	if (seg3 === "import" && !seg4) {
		return Option.some(calendarImportHandler(req, ctx, CollectionId(seg2)));
	}
	if (seg3 !== "events") {
		return Option.none();
	}
	if (seg4 === "create") {
		return Option.some(eventCreateHandler(req, ctx, CollectionId(seg2)));
	}
	if (!(seg4 && isUuid(seg4))) {
		return Option.none();
	}
	if (seg5 === "update") {
		return Option.some(eventUpdateHandler(req, ctx, InstanceId(seg4)));
	}
	if (seg5 === "delete") {
		return Option.some(eventDeleteHandler(req, ctx, InstanceId(seg4)));
	}
	return Option.none();
};

const matchTaskPostRoutes = (route: UiRoute) => {
	const { req, ctx, segments } = route;
	const [, , seg2, seg3, seg4, seg5] = segments;
	if (
		!(isApiPost(route, "tasks") && seg2 && isUuid(seg2)) ||
		seg3 !== "tasks"
	) {
		return Option.none();
	}
	if (seg4 === "create") {
		return Option.some(taskCreateHandler(req, ctx, CollectionId(seg2)));
	}
	if (!(seg4 && isUuid(seg4))) {
		return Option.none();
	}
	const instanceId = InstanceId(seg4);
	if (seg5 === "update") {
		return Option.some(taskUpdateHandler(req, ctx, instanceId));
	}
	if (seg5 === "delete") {
		return Option.some(taskDeleteHandler(req, ctx, instanceId));
	}
	if (seg5 === "toggle") {
		return Option.some(taskToggleHandler(req, ctx, instanceId));
	}
	return Option.none();
};

const matchProfilePostRoutes = (route: UiRoute) => {
	const { req, ctx, segments } = route;
	const [, , seg2, seg3, seg4] = segments;
	if (!isApiPost(route, "profile") || seg4) {
		return Option.none();
	}
	if (seg2 === "email-credentials") {
		if (seg3 === "save") {
			return Option.some(emailCredentialsSaveHandler(req, ctx));
		}
		if (seg3 === "clear") {
			return Option.some(emailCredentialsClearHandler(req, ctx));
		}
	}
	if (seg2 === "app-passwords") {
		if (seg3 === "create") {
			return Option.some(appPasswordsCreateHandler(req, ctx));
		}
		if (seg3 === "revoke") {
			return Option.some(appPasswordsRevokeHandler(req, ctx));
		}
	}
	return Option.none();
};

// Contacts mutations that act on a whole addressbook or a selection
const matchContactBulkPostRoutes = (route: UiRoute) => {
	const { req, ctx, segments } = route;
	const [, , seg2, seg3, seg4] = segments;
	if (!isApiPost(route, "contacts")) {
		return Option.none();
	}
	if (seg2 === "cleanup" && !seg4) {
		if (seg3 === "fix") {
			return Option.some(contactsCleanupFixHandler(req, ctx));
		}
		if (seg3 === "fix-all") {
			return Option.some(contactsCleanupFixAllHandler(req, ctx));
		}
		return Option.none();
	}
	if (seg3) {
		return Option.none();
	}
	if (seg2 === "create") {
		return Option.some(contactsCreateHandler(req, ctx));
	}
	if (seg2 === "bulk-delete") {
		return Option.some(contactsBulkDeleteHandler(req, ctx));
	}
	if (seg2 === "bulk-clear-photo") {
		return Option.some(contactsBulkClearPhotoHandler(req, ctx));
	}
	if (seg2 === "bulk-download") {
		return Option.some(contactsBulkDownloadHandler(req, ctx));
	}
	if (seg2 === "merge") {
		return Option.some(contactsMergeExecuteHandler(req, ctx));
	}
	if (seg2 === "export") {
		return Option.map(addressbookParam(ctx), (bookId) =>
			contactsExportStartHandler(req, ctx, CollectionId(bookId)),
		);
	}
	return Option.none();
};

// Contacts mutations addressed by an addressbook or contact id
const matchContactInstancePostRoutes = (route: UiRoute) => {
	const { req, ctx, segments } = route;
	const [, , seg2, seg3, seg4] = segments;
	if (!(isApiPost(route, "contacts") && seg2 && isUuid(seg2)) || seg4) {
		return Option.none();
	}
	if (seg3 === "import") {
		return Option.some(contactsImportHandler(req, ctx, CollectionId(seg2)));
	}
	if (seg3 === "update") {
		return Option.some(contactsUpdateHandler(req, ctx, InstanceId(seg2)));
	}
	if (seg3 === "delete") {
		return Option.some(contactsDeleteHandler(req, ctx, InstanceId(seg2)));
	}
	return Option.none();
};

const matchSubscriptionPostRoutes = (route: UiRoute) => {
	const { req, ctx, segments } = route;
	const [, , seg2, seg3, seg4] = segments;
	if (!isApiPost(route, "subscriptions")) {
		return Option.none();
	}
	if (seg2 === "create" && !seg3) {
		return Option.some(subscriptionsCreateHandler(req, ctx));
	}
	if (seg2 && isUuid(seg2) && seg3 === "delete" && !seg4) {
		return Option.some(
			subscriptionsDeleteHandler(req, ctx, seg2 as UuidString),
		);
	}
	return Option.none();
};

const matchFeedPostRoutes = (route: UiRoute) => {
	const { req, ctx, segments } = route;
	const [, , seg2, seg3, seg4] = segments;
	if (!isApiPost(route, "feeds")) {
		return Option.none();
	}
	if (seg2 === "create" && !seg3) {
		return Option.some(feedsCreateHandler(req, ctx));
	}
	if (!(seg2 && isUuid(seg2)) || seg4) {
		return Option.none();
	}
	const feedId = seg2 as UuidString;
	if (seg3 === "update") {
		return Option.some(feedsUpdateHandler(req, ctx, feedId));
	}
	if (seg3 === "delete") {
		return Option.some(feedsDeleteHandler(req, ctx, feedId));
	}
	if (seg3 === "regenerate") {
		return Option.some(feedsRegenerateHandler(req, ctx, feedId));
	}
	return Option.none();
};

const matchTrashPostRoutes = (route: UiRoute) => {
	const { req, ctx, segments } = route;
	const [, , seg2, seg3, seg4] = segments;
	if (!(isApiPost(route, "trash") && seg3 && isUuid(seg3))) {
		return Option.none();
	}
	if (seg2 === "collections" && seg4 === "restore") {
		return Option.some(
			trashRestoreCollectionHandler(req, ctx, CollectionId(seg3)),
		);
	}
	if (seg2 === "collections" && seg4 === "purge") {
		return Option.some(
			trashPurgeCollectionHandler(req, ctx, CollectionId(seg3)),
		);
	}
	if (seg2 === "instances" && seg4 === "restore") {
		return Option.some(trashRestoreInstanceHandler(req, ctx, InstanceId(seg3)));
	}
	if (seg2 === "instances" && seg4 === "purge") {
		return Option.some(trashPurgeInstanceHandler(req, ctx, InstanceId(seg3)));
	}
	return Option.none();
};

const matchGroupPostRoutes = (route: UiRoute) => {
	const { req, ctx, segments } = route;
	const [, , seg2, seg3, seg4] = segments;
	if (!isApiPost(route, "groups")) {
		return Option.none();
	}
	if (seg2 === "create" && !seg3) {
		return Option.some(groupsCreateHandler(req, ctx));
	}
	if (!(seg2 && isUuid(seg2))) {
		return Option.none();
	}
	const principalId = PrincipalId(seg2);
	if (seg3 === "update" && !seg4) {
		return Option.some(groupsUpdateHandler(req, ctx, principalId));
	}
	if (seg3 === "delete" && !seg4) {
		return Option.some(groupsDeleteHandler(req, ctx, principalId));
	}
	if (seg3 === "members" && !seg4) {
		return Option.some(groupsMembersHandler(req, ctx, principalId));
	}
	if (seg3 === "collections" && seg4 === "create") {
		return Option.some(groupsCollectionsCreateHandler(req, ctx, principalId));
	}
	return Option.none();
};
// POST API route groups, in priority order
export const UI_API_POST_MATCHERS: ReadonlyArray<
	(
		route: UiRoute,
	) => Option.Option<Effect.Effect<Response, UiError, UiServices>>
> = [
	matchAclPostRoutes,
	matchCollectionPostRoutes,
	matchUserPostRoutes,
	matchCalendarPostRoutes,
	matchTaskPostRoutes,
	matchProfilePostRoutes,
	matchContactBulkPostRoutes,
	matchContactInstancePostRoutes,
	matchSubscriptionPostRoutes,
	matchFeedPostRoutes,
	matchTrashPostRoutes,
	matchGroupPostRoutes,
];
