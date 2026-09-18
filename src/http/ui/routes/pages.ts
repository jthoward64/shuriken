import { Effect, Option } from "effect";
import { AppConfigService } from "#src/config.ts";
import {
	CollectionId,
	InstanceId,
	isUuid,
	PrincipalId,
	type UuidString,
} from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_SEE_OTHER } from "#src/http/status.ts";
import { calendarEventsHandler } from "#src/http/ui/api/calendar/events.ts";
import { sharedCalendarEventsHandler } from "#src/http/ui/api/calendar/shared-events.ts";
import { contactsBulkJobEventsHandler } from "#src/http/ui/api/contacts/bulk-job-events.ts";
import { contactsBulkJobResultHandler } from "#src/http/ui/api/contacts/bulk-job-result.ts";
import { componentEchoHandler } from "#src/http/ui/api/dev/components-echo.tsx";
import { componentSearchHandler } from "#src/http/ui/api/dev/components-search.ts";
import { principalSearchHandler } from "#src/http/ui/api/principals/search.tsx";
import { callbackHandler } from "#src/http/ui/handlers/auth/callback.ts";
import { loginHandler } from "#src/http/ui/handlers/auth/login.ts";
import { logoutHandler } from "#src/http/ui/handlers/auth/logout.ts";
import { eventEditHandler } from "#src/http/ui/handlers/calendar/event-edit.tsx";
import { eventPreviewHandler } from "#src/http/ui/handlers/calendar/event-preview.tsx";
import { calendarExportHandler } from "#src/http/ui/handlers/calendar/export.ts";
import { calendarViewHandler } from "#src/http/ui/handlers/calendar/view.tsx";
import { collectionsEditHandler } from "#src/http/ui/handlers/collections/edit.tsx";
import { contactsCleanupHandler } from "#src/http/ui/handlers/contacts/cleanup.tsx";
import { contactsEditHandler } from "#src/http/ui/handlers/contacts/edit.tsx";
import { contactsExportHandler } from "#src/http/ui/handlers/contacts/export.ts";
import { contactsListHandler } from "#src/http/ui/handlers/contacts/list.tsx";
import { contactsMergeHandler } from "#src/http/ui/handlers/contacts/merge.tsx";
import { contactsNewHandler } from "#src/http/ui/handlers/contacts/new.tsx";
import { contactsPhotoHandler } from "#src/http/ui/handlers/contacts/photo.ts";
import { contactsPreviewHandler } from "#src/http/ui/handlers/contacts/preview.tsx";
import { contactsRelationOptionsHandler } from "#src/http/ui/handlers/contacts/relation-options.tsx";
import { componentGalleryHandler } from "#src/http/ui/handlers/dev/components.tsx";
import { feedsEditHandler } from "#src/http/ui/handlers/feeds/edit.tsx";
import { feedsListHandler } from "#src/http/ui/handlers/feeds/list.tsx";
import { feedsNewHandler } from "#src/http/ui/handlers/feeds/new.tsx";
import { groupsCollectionsNewHandler } from "#src/http/ui/handlers/groups/collections-new.tsx";
import { groupsEditHandler } from "#src/http/ui/handlers/groups/edit.tsx";
import { groupsListHandler } from "#src/http/ui/handlers/groups/list.tsx";
import { groupsNewHandler } from "#src/http/ui/handlers/groups/new.tsx";
import { instanceAclHandler } from "#src/http/ui/handlers/instances/acl.tsx";
import { appPasswordsPageHandler } from "#src/http/ui/handlers/profile/app-passwords.tsx";
import { emailCredentialsPageHandler } from "#src/http/ui/handlers/profile/email-credentials.tsx";
import { profileHandler } from "#src/http/ui/handlers/profile.tsx";
import { subscriptionsListHandler } from "#src/http/ui/handlers/subscriptions/list.tsx";
import { subscriptionsNewHandler } from "#src/http/ui/handlers/subscriptions/new.tsx";
import { taskEditHandler } from "#src/http/ui/handlers/tasks/edit.tsx";
import { tasksListHandler } from "#src/http/ui/handlers/tasks/list.tsx";
import { tasksNewHandler } from "#src/http/ui/handlers/tasks/new.tsx";
import { trashListHandler } from "#src/http/ui/handlers/trash/list.tsx";
import { usersCollectionsNewHandler } from "#src/http/ui/handlers/users/collections-new.tsx";
import { usersEditHandler } from "#src/http/ui/handlers/users/edit.tsx";
import { usersListHandler } from "#src/http/ui/handlers/users/list.tsx";
import { usersNewHandler } from "#src/http/ui/handlers/users/new.tsx";
import type { UiPageOpts } from "#src/http/ui/helpers/page-opts.ts";
import { addressbookParam } from "#src/http/ui/routes/params.ts";
import type {
	UiError,
	UiRoute,
	UiServices,
} from "#src/http/ui/routes/types.ts";
import { renderNotFound } from "#src/http/ui/view/shell/render.tsx";

// ---------------------------------------------------------------------------
// Page routes (GET)
// ---------------------------------------------------------------------------

// The calendar is the default page, so the bare /ui (and /) redirects to it
const matchRootRedirect = ({ method, segments }: UiRoute) => {
	const [seg0] = segments;
	if (seg0 || method !== "GET") {
		return Option.none();
	}
	return Option.some(
		Effect.succeed(
			new Response(null, {
				status: HTTP_SEE_OTHER,
				headers: { Location: "/ui/calendar" },
			}),
		),
	);
};

// OIDC web-login flow (reachable unauthenticated)
const matchAuthRoutes = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1, seg2] = segments;
	if (seg0 !== "auth" || seg2) {
		return Option.none();
	}
	if (seg1 === "login" && method === "GET") {
		return Option.some(loginHandler(req, ctx));
	}
	if (seg1 === "callback" && method === "GET") {
		return Option.some(callbackHandler(req, ctx));
	}
	if (seg1 === "logout" && method === "POST") {
		return Option.some(logoutHandler(req, ctx));
	}
	return Option.none();
};

// Component gallery (see handlers/dev/components.tsx)
const matchDevGallery = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1, seg2] = segments;
	if (seg0 === "dev" && seg1 === "components" && !seg2 && method === "GET") {
		return Option.some(componentGalleryHandler(req, ctx));
	}
	return Option.none();
};

const matchProfilePages = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1, seg2] = segments;
	if (seg0 !== "profile" || method !== "GET" || seg2) {
		return Option.none();
	}
	if (!seg1) {
		return Option.some(profileHandler(req, ctx));
	}
	if (seg1 === "email-credentials") {
		return Option.some(emailCredentialsPageHandler(req, ctx));
	}
	if (seg1 === "app-passwords") {
		return Option.some(appPasswordsPageHandler(req, ctx));
	}
	return Option.none();
};

const matchCollectionPages = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1, seg2] = segments;
	if (
		seg0 === "collections" &&
		method === "GET" &&
		seg1 &&
		isUuid(seg1) &&
		!seg2
	) {
		return Option.some(collectionsEditHandler(req, ctx, CollectionId(seg1)));
	}
	return Option.none();
};

const matchUserPages = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1, seg2, seg3, seg4] = segments;
	if (seg0 !== "users" || method !== "GET") {
		return Option.none();
	}
	if (!seg1) {
		return Option.some(usersListHandler(req, ctx));
	}
	if (seg1 === "new" && !seg2) {
		return Option.some(usersNewHandler(req, ctx));
	}
	if (isUuid(seg1) && seg2 === "collections" && seg3 === "new" && !seg4) {
		return Option.some(usersCollectionsNewHandler(req, ctx, PrincipalId(seg1)));
	}
	if (isUuid(seg1) && !seg2) {
		return Option.some(usersEditHandler(req, ctx, PrincipalId(seg1)));
	}
	return Option.none();
};

const matchGroupPages = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1, seg2, seg3, seg4] = segments;
	if (seg0 !== "groups" || method !== "GET") {
		return Option.none();
	}
	if (!seg1) {
		return Option.some(groupsListHandler(req, ctx));
	}
	if (seg1 === "new" && !seg2) {
		return Option.some(groupsNewHandler(req, ctx));
	}
	if (isUuid(seg1) && seg2 === "collections" && seg3 === "new" && !seg4) {
		return Option.some(
			groupsCollectionsNewHandler(req, ctx, PrincipalId(seg1)),
		);
	}
	if (isUuid(seg1) && !seg2) {
		return Option.some(groupsEditHandler(req, ctx, PrincipalId(seg1)));
	}
	return Option.none();
};

const matchTrashPage = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1] = segments;
	if (seg0 === "trash" && method === "GET" && !seg1) {
		return Option.some(trashListHandler(req, ctx));
	}
	return Option.none();
};

// Feeds (share-link management)
const matchFeedPages = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1, seg2] = segments;
	if (seg0 !== "feeds" || method !== "GET") {
		return Option.none();
	}
	if (!seg1) {
		return Option.some(feedsListHandler(req, ctx));
	}
	if (seg1 === "new" && !seg2) {
		return Option.some(feedsNewHandler(req, ctx));
	}
	if (isUuid(seg1) && !seg2) {
		return Option.some(feedsEditHandler(req, ctx, seg1 as UuidString));
	}
	return Option.none();
};

// A chrome-less embedded pane: the same page handler, gated by EMBED_PANES_ENABLED
const embedPane = Effect.fn("ui.embedPane")(function* (
	handler: (
		req: Request,
		ctx: HttpRequestContext,
		opts: UiPageOpts,
	) => Effect.Effect<Response, UiError, UiServices>,
	req: Request,
	ctx: HttpRequestContext,
) {
	const config = yield* AppConfigService;
	if (!config.embed.panesEnabled) {
		return yield* renderNotFound(ctx.headers);
	}
	return yield* handler(req, ctx, { chrome: "embed" });
});

// Embedded panes (chrome-less, still authenticated) reuse the full page handlers
const matchEmbedPanes = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1, seg2] = segments;
	if (seg0 !== "embed" || method !== "GET" || !seg1 || seg2) {
		return Option.none();
	}
	if (seg1 === "calendar") {
		return Option.some(embedPane(calendarViewHandler, req, ctx));
	}
	if (seg1 === "contacts") {
		return Option.some(embedPane(contactsListHandler, req, ctx));
	}
	if (seg1 === "tasks") {
		return Option.some(embedPane(tasksListHandler, req, ctx));
	}
	return Option.none();
};

// Calendar viewer plus the event pages hanging off a calendar
const matchCalendarPages = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1, seg2, seg3, seg4] = segments;
	if (seg0 !== "calendar" || method !== "GET") {
		return Option.none();
	}
	if (!seg1) {
		return Option.some(calendarViewHandler(req, ctx));
	}
	if (!isUuid(seg1)) {
		return Option.none();
	}
	if (seg2 === "export.ics" && !seg3) {
		return Option.some(
			calendarExportHandler(
				req,
				ctx,
				CollectionId(seg1),
				ctx.url.searchParams.get("name") ?? "calendar",
			),
		);
	}
	if (seg2 === "events" && seg3 && isUuid(seg3) && !seg4) {
		return Option.some(eventEditHandler(req, ctx, InstanceId(seg3)));
	}
	if (seg2 === "events" && seg3 && isUuid(seg3) && seg4 === "preview") {
		return Option.some(eventPreviewHandler(req, ctx, InstanceId(seg3)));
	}
	return Option.none();
};

const matchTaskPages = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1, seg2] = segments;
	if (seg0 !== "tasks" || method !== "GET") {
		return Option.none();
	}
	if (!seg1) {
		return Option.some(tasksListHandler(req, ctx));
	}
	if (seg1 === "new" && !seg2) {
		return Option.some(tasksNewHandler(req, ctx));
	}
	if (isUuid(seg1) && !seg2) {
		return Option.some(taskEditHandler(req, ctx, InstanceId(seg1)));
	}
	return Option.none();
};

// Component gallery demo endpoints: the echo panel and the SearchPicker lookup
const matchDevApiRoutes = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1, seg2, seg3, seg4] = segments;
	if (seg0 !== "api" || seg1 !== "dev" || seg2 !== "components" || seg4) {
		return Option.none();
	}
	if (seg3 === "echo" && method === "POST") {
		return Option.some(componentEchoHandler(req, ctx));
	}
	if (seg3 === "search" && method === "GET") {
		return Option.some(componentSearchHandler(req, ctx));
	}
	return Option.none();
};

// Calendar JSON feeds: the synthetic "shared events" pseudo-calendar is checked
// first because "shared-events" is never a real collection id.
const matchCalendarApiRoutes = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1, seg2, seg3, seg4] = segments;
	if (seg0 !== "api" || seg1 !== "calendar" || seg3 !== "events" || seg4) {
		return Option.none();
	}
	if (method !== "GET") {
		return Option.none();
	}
	if (seg2 === "shared-events") {
		return Option.some(sharedCalendarEventsHandler(req, ctx));
	}
	if (seg2 && isUuid(seg2)) {
		return Option.some(calendarEventsHandler(req, ctx, CollectionId(seg2)));
	}
	return Option.none();
};

// Bulk-job progress SSE and result download (contacts bulk actions)
const matchBulkJobApiRoutes = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1, seg2, seg3, seg4] = segments;
	if (
		seg0 !== "api" ||
		seg1 !== "contacts" ||
		seg2 !== "bulk-jobs" ||
		!seg3 ||
		!isUuid(seg3) ||
		segments[5] ||
		method !== "GET"
	) {
		return Option.none();
	}
	if (seg4 === "events") {
		return Option.some(
			contactsBulkJobEventsHandler(req, ctx, seg3 as UuidString),
		);
	}
	if (seg4 === "result") {
		return Option.some(
			contactsBulkJobResultHandler(req, ctx, seg3 as UuidString),
		);
	}
	return Option.none();
};

// Contacts pages that are not addressed by a contact id
const matchContactCollectionPages = ({
	req,
	ctx,
	method,
	segments,
}: UiRoute) => {
	const [seg0, seg1, seg2] = segments;
	if (seg0 !== "contacts" || method !== "GET" || seg2) {
		return Option.none();
	}
	if (!seg1) {
		return Option.some(contactsListHandler(req, ctx));
	}
	if (seg1 === "new") {
		return Option.some(contactsNewHandler(req, ctx));
	}
	if (seg1 === "merge") {
		return Option.some(contactsMergeHandler(req, ctx));
	}
	if (seg1 === "cleanup") {
		return Option.some(contactsCleanupHandler(req, ctx));
	}
	if (seg1 === "relation-options") {
		return Option.map(addressbookParam(ctx), (bookId) =>
			contactsRelationOptionsHandler(req, ctx, CollectionId(bookId)),
		);
	}
	if (seg1 === "export.vcf") {
		return Option.map(addressbookParam(ctx), (bookId) =>
			contactsExportHandler(
				req,
				ctx,
				CollectionId(bookId),
				ctx.url.searchParams.get("name") ?? "contacts",
			),
		);
	}
	return Option.none();
};

// Contacts pages addressed by a contact id
const matchContactInstancePages = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1, seg2, seg3] = segments;
	if (seg0 !== "contacts" || method !== "GET" || !seg1 || !isUuid(seg1)) {
		return Option.none();
	}
	const instanceId = InstanceId(seg1);
	if (seg2 === "photo" && !seg3) {
		return Option.some(contactsPhotoHandler(req, ctx, instanceId));
	}
	if (seg2 === "preview" && !seg3) {
		return Option.some(contactsPreviewHandler(req, ctx, instanceId));
	}
	if (!seg2) {
		return Option.some(contactsEditHandler(req, ctx, instanceId));
	}
	return Option.none();
};

// Per-instance ACL editor
const matchInstanceAclPage = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1, seg2, seg3] = segments;
	if (
		seg0 === "instances" &&
		seg1 &&
		isUuid(seg1) &&
		seg2 === "acl" &&
		!seg3 &&
		method === "GET"
	) {
		return Option.some(instanceAclHandler(req, ctx, InstanceId(seg1)));
	}
	return Option.none();
};

const matchSubscriptionPages = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1, seg2] = segments;
	if (seg0 !== "subscriptions" || method !== "GET") {
		return Option.none();
	}
	if (!seg1) {
		return Option.some(subscriptionsListHandler(req, ctx));
	}
	if (seg1 === "new" && !seg2) {
		return Option.some(subscriptionsNewHandler(req, ctx));
	}
	return Option.none();
};

// Share picker "pick a user" typeahead
const matchPrincipalSearchApi = ({ req, ctx, method, segments }: UiRoute) => {
	const [seg0, seg1, seg2, seg3] = segments;
	if (
		seg0 === "api" &&
		seg1 === "principals" &&
		seg2 === "search" &&
		!seg3 &&
		method === "GET"
	) {
		return Option.some(principalSearchHandler(req, ctx));
	}
	return Option.none();
};
// Page and GET-API route groups, in priority order
export const UI_PAGE_MATCHERS: ReadonlyArray<
	(
		route: UiRoute,
	) => Option.Option<Effect.Effect<Response, UiError, UiServices>>
> = [
	matchRootRedirect,
	matchAuthRoutes,
	matchDevGallery,
	matchProfilePages,
	matchCollectionPages,
	matchUserPages,
	matchGroupPages,
	matchTrashPage,
	matchFeedPages,
	matchEmbedPanes,
	matchCalendarPages,
	matchTaskPages,
	matchDevApiRoutes,
	matchCalendarApiRoutes,
	matchBulkJobApiRoutes,
	matchContactCollectionPages,
	matchContactInstancePages,
	matchInstanceAclPage,
	matchSubscriptionPages,
	matchPrincipalSearchApi,
];
