import { Effect, Match } from "effect";
import { AppConfigService } from "#src/config.ts";
import type { DatabaseClient } from "#src/db/client.ts";
import type {
	ConflictError,
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import {
	CollectionId,
	InstanceId,
	isUuid,
	PrincipalId,
	type UuidString,
	VirtualResourceId,
} from "#src/domain/ids.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	HTTP_CONFLICT,
	HTTP_FORBIDDEN,
	HTTP_NOT_FOUND,
	HTTP_OK,
	HTTP_SEE_OTHER,
	HTTP_UNAUTHORIZED,
} from "#src/http/status.ts";
import { aclGrantHandler } from "#src/http/ui/api/acl/grant.tsx";
import { aclRevokeHandler } from "#src/http/ui/api/acl/revoke.tsx";
import {
	eventCreateHandler,
	eventDeleteHandler,
	eventUpdateHandler,
} from "#src/http/ui/api/calendar/event-write.ts";
import { calendarEventsHandler } from "#src/http/ui/api/calendar/events.ts";
import { calendarImportHandler } from "#src/http/ui/api/calendar/import.tsx";
import { sharedCalendarEventsHandler } from "#src/http/ui/api/calendar/shared-events.ts";
import { collectionsDeleteHandler } from "#src/http/ui/api/collections/delete.ts";
import { collectionsFeedsAddHandler } from "#src/http/ui/api/collections/feeds-add.tsx";
import { collectionsMoveHandler } from "#src/http/ui/api/collections/move.ts";
import { collectionsRegenerateBirthdaysHandler } from "#src/http/ui/api/collections/regenerate-birthdays.ts";
import { collectionsReorderHandler } from "#src/http/ui/api/collections/reorder.ts";
import { collectionsUpdateHandler } from "#src/http/ui/api/collections/update.ts";
import { contactsBulkClearPhotoHandler } from "#src/http/ui/api/contacts/bulk-clear-photo.tsx";
import { contactsBulkDeleteHandler } from "#src/http/ui/api/contacts/bulk-delete.tsx";
import { contactsBulkDownloadHandler } from "#src/http/ui/api/contacts/bulk-download.tsx";
import { contactsBulkJobEventsHandler } from "#src/http/ui/api/contacts/bulk-job-events.ts";
import { contactsBulkJobResultHandler } from "#src/http/ui/api/contacts/bulk-job-result.ts";
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
import type { ClientJsService } from "#src/http/ui/client/index.ts";
import type { CssService } from "#src/http/ui/css/index.ts";
import { callbackHandler } from "#src/http/ui/handlers/auth/callback.ts";
import { loginHandler } from "#src/http/ui/handlers/auth/login.ts";
import { logoutHandler } from "#src/http/ui/handlers/auth/logout.ts";
import { eventEditHandler } from "#src/http/ui/handlers/calendar/event-edit.tsx";
import { eventPreviewHandler } from "#src/http/ui/handlers/calendar/event-preview.tsx";
import { calendarExportHandler } from "#src/http/ui/handlers/calendar/export.ts";
import { calendarViewHandler } from "#src/http/ui/handlers/calendar/view.tsx";
import { clientJsHandler } from "#src/http/ui/handlers/client-js.ts";
import { collectionsEditHandler } from "#src/http/ui/handlers/collections/edit.tsx";
import { contactsCleanupHandler } from "#src/http/ui/handlers/contacts/cleanup.tsx";
import { contactsEditHandler } from "#src/http/ui/handlers/contacts/edit.tsx";
import { contactsExportHandler } from "#src/http/ui/handlers/contacts/export.ts";
import { contactsListHandler } from "#src/http/ui/handlers/contacts/list.tsx";
import { contactsMergeHandler } from "#src/http/ui/handlers/contacts/merge.tsx";
import { contactsNewHandler } from "#src/http/ui/handlers/contacts/new.tsx";
import { contactsPhotoHandler } from "#src/http/ui/handlers/contacts/photo.ts";
import { contactsPreviewHandler } from "#src/http/ui/handlers/contacts/preview.tsx";
import { cssAssetHandler } from "#src/http/ui/handlers/css.ts";
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
import { staticHandler } from "#src/http/ui/handlers/static.ts";
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
import { isHtmxRequest } from "#src/http/ui/helpers/htmx.ts";
import type { PageCacheService } from "#src/http/ui/page-cache/index.ts";
import {
	renderForbidden,
	renderNotFound,
	renderServerError,
} from "#src/http/ui/view/render.tsx";
import type { FileService } from "#src/platform/file.ts";
import type { AclService } from "#src/services/acl/index.ts";
import type { AclRepository } from "#src/services/acl/repository.ts";
import type { AppPasswordService } from "#src/services/app-password/service.ts";
import type { BirthdayService } from "#src/services/birthday/service.ts";
import type { BulkJobRepository } from "#src/services/bulk-job/index.ts";
import type { CalEditService } from "#src/services/cal-edit/service.ts";
import type { CalIndexRepository } from "#src/services/cal-index/repository.ts";
import type { CardEditService } from "#src/services/card-edit/service.ts";
import type { CardIndexRepository } from "#src/services/card-index/repository.ts";
import type { CollectionService } from "#src/services/collection/index.ts";
import type { CollectionRepository } from "#src/services/collection/repository.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { ContactCleanupService } from "#src/services/contact-cleanup/service.ts";
import type { ContactMergeService } from "#src/services/contact-merge/service.ts";
import type { UserEmailCredentialRepository } from "#src/services/email-credential/repository.ts";
import type { EmailCredentialService } from "#src/services/email-credential/service.ts";
import type { EntityRepository } from "#src/services/entity/index.ts";
import type { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import type { SubscriptionService } from "#src/services/external-calendar/subscription.ts";
import type { GroupService } from "#src/services/group/index.ts";
import type { ImipDispatchService } from "#src/services/imip/dispatch.ts";
import type { InstanceService } from "#src/services/instance/index.ts";
import type { InstanceRepository } from "#src/services/instance/repository.ts";
import type { OidcService } from "#src/services/oidc/service.ts";
import type { PrincipalService } from "#src/services/principal/index.ts";
import type { PrincipalRepository } from "#src/services/principal/repository.ts";
import type { ProvisioningService } from "#src/services/provisioning/service.ts";
import type { OidcLoginRepository } from "#src/services/session/oidc-login-repository.ts";
import type { SessionService } from "#src/services/session/service.ts";
import type { ShareLinkService } from "#src/services/share-link/service.ts";
import type { TaskEditService } from "#src/services/task-edit/service.ts";
import type { TrashService } from "#src/services/trash/index.ts";
import type { UserService } from "#src/services/user/index.ts";
import type { UserRepository } from "#src/services/user/repository.ts";
import { profileHandler } from "./handlers/profile.tsx";

// ---------------------------------------------------------------------------
// UI service union — all services the UI router and its handlers can use
// ---------------------------------------------------------------------------

export type UiServices =
	| AppConfigService
	| CssService
	| ClientJsService
	| AclRepository
	| AclService
	| AppPasswordService
	| BirthdayService
	| BulkJobRepository
	| OidcService
	| OidcLoginRepository
	| SessionService
	| UserRepository
	| FileService
	| CalEditService
	| CalIndexRepository
	| CardEditService
	| DatabaseClient
	| EmailCredentialService
	| EntityRepository
	| ImipDispatchService
	| PageCacheService
	| UserEmailCredentialRepository
	| CardIndexRepository
	| CollectionRepository
	| CollectionService
	| ComponentRepository
	| ContactCleanupService
	| ContactMergeService
	| ExternalCalendarRepository
	| GroupService
	| InstanceRepository
	| InstanceService
	| SubscriptionService
	| PrincipalRepository
	| PrincipalService
	| ProvisioningService
	| ShareLinkService
	| TaskEditService
	| TrashService
	| UserService;

// ---------------------------------------------------------------------------
// Error → Response mapping for UI errors
// ---------------------------------------------------------------------------

type UiError = DavError | DatabaseError | InternalError | ConflictError;

const mapUiError = (
	err: UiError,
	ctx: HttpRequestContext,
	basicAuthEnabled: boolean,
	oidcEnabled: boolean,
): Effect.Effect<Response, never> =>
	Match.value(err).pipe(
		Match.tag("DavError", (e) => {
			if (e.status === HTTP_UNAUTHORIZED) {
				// Browser UI: send unauthenticated users to the OIDC login page rather
				// than provoking a Basic-auth popup. DAV/API 401s (handled in the
				// top-level router) still advertise Basic for client compatibility.
				if (oidcEnabled) {
					const loginUrl = `/ui/auth/login?returnTo=${encodeURIComponent(
						ctx.url.pathname,
					)}`;
					if (isHtmxRequest(ctx.headers)) {
						return Effect.succeed(
							new Response(null, {
								status: HTTP_OK,
								headers: { "HX-Redirect": loginUrl },
							}),
						);
					}
					return Effect.succeed(
						new Response(null, {
							status: HTTP_SEE_OTHER,
							headers: { Location: loginUrl },
						}),
					);
				}
				if (basicAuthEnabled) {
					return Effect.succeed(
						new Response(null, {
							status: HTTP_UNAUTHORIZED,
							headers: { "WWW-Authenticate": 'Basic realm="shuriken"' },
						}),
					);
				}
				return Effect.succeed(
					new Response(null, {
						status: HTTP_SEE_OTHER,
						headers: { Location: "/ui/profile" },
					}),
				);
			}
			if (e.status === HTTP_FORBIDDEN) {
				return renderForbidden(ctx.headers);
			}
			if (e.status === HTTP_NOT_FOUND) {
				return renderNotFound(ctx.headers);
			}
			return Effect.succeed(
				new Response(e.message ?? "Error", { status: e.status }),
			);
		}),
		Match.tag("DatabaseError", "InternalError", (e) =>
			Effect.logError("ui handler failed", {
				cause: (e as { cause: unknown }).cause,
			}).pipe(Effect.andThen(renderServerError(ctx.headers))),
		),
		Match.tag("ConflictError", (e) =>
			Effect.succeed(new Response(e.message, { status: HTTP_CONFLICT })),
		),
		Match.exhaustive,
	);

// ---------------------------------------------------------------------------
// Route helpers
// ---------------------------------------------------------------------------

const UI_PATH_PREFIX = "/ui/";
const UI_PATH_PREFIX_LEN = UI_PATH_PREFIX.length;

const getUiPath = (pathname: string): string | null => {
	if (pathname.startsWith(UI_PATH_PREFIX)) {
		return pathname.slice(UI_PATH_PREFIX_LEN);
	}
	if (pathname === "/ui" || pathname === "/") {
		return "";
	}
	return null;
};

// ---------------------------------------------------------------------------
// UI router
// ---------------------------------------------------------------------------

export const uiRouter = (
	req: Request,
	ctx: HttpRequestContext,
): Effect.Effect<Response, never, UiServices> => {
	const { pathname } = ctx.url;
	const method = req.method.toUpperCase();

	// Design-system stylesheet — compiled in-memory at startup, served with a
	// strong ETag. Checked before the generic file static handler.
	if (pathname === "/static/app.css") {
		return cssAssetHandler(req);
	}

	// Browser scripts bundled from TypeScript at startup (see ClientJsService).
	// Checked before the generic file handler so the bundled build wins over any
	// stale on-disk copy of the same name.
	if (pathname === "/static/calendar.js") {
		return clientJsHandler(req, "calendar.js");
	}
	if (pathname === "/static/calendar.css") {
		return clientJsHandler(req, "calendar.css");
	}
	if (pathname === "/static/reorder.js") {
		return clientJsHandler(req, "reorder.js");
	}
	if (pathname === "/static/embed-widget.js") {
		return clientJsHandler(req, "embed-widget.js");
	}
	if (pathname === "/static/embed-widget.css") {
		return clientJsHandler(req, "embed-widget.css");
	}

	if (pathname.startsWith("/static/")) {
		return staticHandler(req).pipe(
			Effect.catch(() =>
				Effect.succeed(new Response(null, { status: HTTP_NOT_FOUND })),
			),
		);
	}

	const uiPath = getUiPath(pathname);
	if (uiPath === null) {
		return Effect.succeed(new Response(null, { status: HTTP_NOT_FOUND }));
	}

	const segments = uiPath.split("/").filter(Boolean) as Array<string>;
	const [seg0, seg1, seg2, seg3, seg4] = segments;

	const handle = (
		eff: Effect.Effect<Response, UiError, UiServices>,
	): Effect.Effect<Response, never, UiServices> =>
		Effect.gen(function* () {
			const config = yield* AppConfigService;
			return yield* eff.pipe(
				Effect.catch((err) =>
					mapUiError(
						err,
						ctx,
						config.auth.basicAuthEnabled,
						config.auth.oidcEnabled,
					),
				),
			);
		});

	const notFound = (): Effect.Effect<Response, never, UiServices> =>
		renderNotFound(ctx.headers);

	// The calendar is the default page — redirect the bare /ui (and /) to it.
	if (!seg0 && method === "GET") {
		return Effect.succeed(
			new Response(null, {
				status: HTTP_SEE_OTHER,
				headers: { Location: "/ui/calendar" },
			}),
		);
	}

	// OIDC web-login flow (reachable unauthenticated)
	if (seg0 === "auth" && !seg2) {
		if (seg1 === "login" && method === "GET") {
			return handle(loginHandler(req, ctx));
		}
		if (seg1 === "callback" && method === "GET") {
			return handle(callbackHandler(req, ctx));
		}
		if (seg1 === "logout" && method === "POST") {
			return handle(logoutHandler(req, ctx));
		}
	}

	// Profile
	if (seg0 === "profile" && !seg1 && method === "GET") {
		return handle(profileHandler(req, ctx));
	}
	if (
		seg0 === "profile" &&
		seg1 === "email-credentials" &&
		!seg2 &&
		method === "GET"
	) {
		return handle(emailCredentialsPageHandler(req, ctx));
	}
	if (
		seg0 === "profile" &&
		seg1 === "app-passwords" &&
		!seg2 &&
		method === "GET"
	) {
		return handle(appPasswordsPageHandler(req, ctx));
	}

	// Collections (GET pages)
	if (
		seg0 === "collections" &&
		method === "GET" &&
		seg1 &&
		isUuid(seg1) &&
		!seg2
	) {
		return handle(collectionsEditHandler(req, ctx, CollectionId(seg1)));
	}

	// Users (GET pages)
	if (seg0 === "users" && method === "GET") {
		if (!seg1) {
			return handle(usersListHandler(req, ctx));
		}
		if (seg1 === "new" && !seg2) {
			return handle(usersNewHandler(req, ctx));
		}
		if (
			seg1 &&
			isUuid(seg1) &&
			seg2 === "collections" &&
			seg3 === "new" &&
			!seg4
		) {
			return handle(usersCollectionsNewHandler(req, ctx, PrincipalId(seg1)));
		}
		if (seg1 && isUuid(seg1) && !seg2) {
			return handle(usersEditHandler(req, ctx, PrincipalId(seg1)));
		}
	}

	// Groups (GET pages)
	if (seg0 === "groups" && method === "GET") {
		if (!seg1) {
			return handle(groupsListHandler(req, ctx));
		}
		if (seg1 === "new" && !seg2) {
			return handle(groupsNewHandler(req, ctx));
		}
		if (
			seg1 &&
			isUuid(seg1) &&
			seg2 === "collections" &&
			seg3 === "new" &&
			!seg4
		) {
			return handle(groupsCollectionsNewHandler(req, ctx, PrincipalId(seg1)));
		}
		if (seg1 && isUuid(seg1) && !seg2) {
			return handle(groupsEditHandler(req, ctx, PrincipalId(seg1)));
		}
	}

	// Trash bin
	if (seg0 === "trash" && method === "GET" && !seg1) {
		return handle(trashListHandler(req, ctx));
	}

	// Feeds (share-link management)
	if (seg0 === "feeds" && method === "GET") {
		if (!seg1) {
			return handle(feedsListHandler(req, ctx));
		}
		if (seg1 === "new" && !seg2) {
			return handle(feedsNewHandler(req, ctx));
		}
		if (seg1 && isUuid(seg1) && !seg2) {
			return handle(feedsEditHandler(req, ctx, seg1 as UuidString));
		}
	}

	// Embedded panes (chrome-less, still authenticated) — gated by
	// EMBED_PANES_ENABLED. Reuse the same handlers as the full pages; only the
	// `chrome: "embed"` option differs (see EmbedConfig, Layout).
	if (seg0 === "embed" && method === "GET" && seg1 && !seg2) {
		if (seg1 === "calendar") {
			return handle(
				AppConfigService.pipe(
					Effect.flatMap((config) =>
						config.embed.panesEnabled
							? calendarViewHandler(req, ctx, { chrome: "embed" })
							: renderNotFound(ctx.headers),
					),
				),
			);
		}
		if (seg1 === "contacts") {
			return handle(
				AppConfigService.pipe(
					Effect.flatMap((config) =>
						config.embed.panesEnabled
							? contactsListHandler(req, ctx, { chrome: "embed" })
							: renderNotFound(ctx.headers),
					),
				),
			);
		}
		if (seg1 === "tasks") {
			return handle(
				AppConfigService.pipe(
					Effect.flatMap((config) =>
						config.embed.panesEnabled
							? tasksListHandler(req, ctx, { chrome: "embed" })
							: renderNotFound(ctx.headers),
					),
				),
			);
		}
	}

	// Calendar viewer + event pages
	if (seg0 === "calendar" && method === "GET") {
		if (!seg1) {
			return handle(calendarViewHandler(req, ctx));
		}
		if (seg1 && isUuid(seg1) && seg2 === "export.ics" && !seg3) {
			return handle(
				calendarExportHandler(
					req,
					ctx,
					CollectionId(seg1),
					ctx.url.searchParams.get("name") ?? "calendar",
				),
			);
		}
		if (
			seg1 &&
			isUuid(seg1) &&
			seg2 === "events" &&
			seg3 &&
			isUuid(seg3) &&
			!seg4
		) {
			return handle(eventEditHandler(req, ctx, InstanceId(seg3)));
		}
		if (
			seg1 &&
			isUuid(seg1) &&
			seg2 === "events" &&
			seg3 &&
			isUuid(seg3) &&
			seg4 === "preview"
		) {
			return handle(eventPreviewHandler(req, ctx, InstanceId(seg3)));
		}
	}

	// Tasks (GET pages)
	if (seg0 === "tasks" && method === "GET") {
		if (!seg1) {
			return handle(tasksListHandler(req, ctx));
		}
		if (seg1 === "new" && !seg2) {
			return handle(tasksNewHandler(req, ctx));
		}
		if (seg1 && isUuid(seg1) && !seg2) {
			return handle(taskEditHandler(req, ctx, InstanceId(seg1)));
		}
	}

	// Synthetic "Shared events" pseudo-calendar feed — individually-shared VEVENT
	// instances not covered by an owned/shared calendar. Must be checked before
	// the UUID-based route below since "shared-events" is never a real collection id.
	if (
		seg0 === "api" &&
		seg1 === "calendar" &&
		seg2 === "shared-events" &&
		seg3 === "events" &&
		!seg4 &&
		method === "GET"
	) {
		return handle(sharedCalendarEventsHandler(req, ctx));
	}

	// Calendar events JSON feed
	if (
		seg0 === "api" &&
		seg1 === "calendar" &&
		seg2 &&
		isUuid(seg2) &&
		seg3 === "events" &&
		!seg4 &&
		method === "GET"
	) {
		return handle(calendarEventsHandler(req, ctx, CollectionId(seg2)));
	}

	// Bulk-job progress SSE + result download (contacts bulk actions)
	if (
		seg0 === "api" &&
		seg1 === "contacts" &&
		seg2 === "bulk-jobs" &&
		seg3 &&
		isUuid(seg3) &&
		!segments[5] &&
		method === "GET"
	) {
		if (seg4 === "events") {
			return handle(contactsBulkJobEventsHandler(req, ctx, seg3 as UuidString));
		}
		if (seg4 === "result") {
			return handle(contactsBulkJobResultHandler(req, ctx, seg3 as UuidString));
		}
	}

	// Contacts (GET pages)
	if (seg0 === "contacts" && method === "GET") {
		if (!seg1) {
			return handle(contactsListHandler(req, ctx));
		}
		if (seg1 === "new" && !seg2) {
			return handle(contactsNewHandler(req, ctx));
		}
		if (seg1 === "merge" && !seg2) {
			return handle(contactsMergeHandler(req, ctx));
		}
		if (seg1 === "cleanup" && !seg2) {
			return handle(contactsCleanupHandler(req, ctx));
		}
		if (seg1 === "export.vcf" && !seg2) {
			const bookId = ctx.url.searchParams.get("addressbook");
			if (bookId !== null && isUuid(bookId)) {
				return handle(
					contactsExportHandler(
						req,
						ctx,
						CollectionId(bookId),
						ctx.url.searchParams.get("name") ?? "contacts",
					),
				);
			}
		}
		if (seg1 && isUuid(seg1) && seg2 === "photo" && !seg3) {
			return handle(contactsPhotoHandler(req, ctx, InstanceId(seg1)));
		}
		if (seg1 && isUuid(seg1) && seg2 === "preview" && !seg3) {
			return handle(contactsPreviewHandler(req, ctx, InstanceId(seg1)));
		}
		if (seg1 && isUuid(seg1) && !seg2) {
			return handle(contactsEditHandler(req, ctx, InstanceId(seg1)));
		}
	}

	// Per-instance ACL editor
	if (
		seg0 === "instances" &&
		seg1 &&
		isUuid(seg1) &&
		seg2 === "acl" &&
		!seg3 &&
		method === "GET"
	) {
		return handle(instanceAclHandler(req, ctx, InstanceId(seg1)));
	}

	// Subscriptions (GET pages)
	if (seg0 === "subscriptions" && method === "GET") {
		if (!seg1) {
			return handle(subscriptionsListHandler(req, ctx));
		}
		if (seg1 === "new" && !seg2) {
			return handle(subscriptionsNewHandler(req, ctx));
		}
	}

	// API endpoints (POST)
	if (seg0 === "api" && method === "POST") {
		if (
			seg1 === "acl" &&
			(seg2 === "principal" ||
				seg2 === "collection" ||
				seg2 === "instance" ||
				seg2 === "virtual") &&
			seg3 &&
			isUuid(seg3) &&
			(seg4 === "grant" || seg4 === "revoke")
		) {
			const resourceId =
				seg2 === "principal"
					? PrincipalId(seg3)
					: seg2 === "collection"
						? CollectionId(seg3)
						: seg2 === "instance"
							? InstanceId(seg3)
							: VirtualResourceId(seg3);
			if (seg4 === "grant") {
				return handle(aclGrantHandler(req, ctx, seg2, resourceId));
			}
			return handle(aclRevokeHandler(req, ctx, seg2, resourceId));
		}
		if (seg1 === "collections") {
			if (seg2 === "reorder" && !seg3) {
				return handle(collectionsReorderHandler(req, ctx));
			}
			if (seg2 && isUuid(seg2) && seg3 === "update" && !seg4) {
				return handle(collectionsUpdateHandler(req, ctx, CollectionId(seg2)));
			}
			if (seg2 && isUuid(seg2) && seg3 === "delete" && !seg4) {
				return handle(collectionsDeleteHandler(req, ctx, CollectionId(seg2)));
			}
			if (
				seg2 &&
				isUuid(seg2) &&
				seg3 === "move" &&
				(seg4 === "up" || seg4 === "down")
			) {
				return handle(
					collectionsMoveHandler(req, ctx, CollectionId(seg2), seg4),
				);
			}
			if (seg2 && isUuid(seg2) && seg3 === "feeds" && seg4 === "add") {
				return handle(collectionsFeedsAddHandler(req, ctx, CollectionId(seg2)));
			}
			if (seg2 && isUuid(seg2) && seg3 === "regenerate-birthdays" && !seg4) {
				return handle(
					collectionsRegenerateBirthdaysHandler(req, ctx, CollectionId(seg2)),
				);
			}
		}
		if (seg1 === "users") {
			if (seg2 === "create" && !seg3) {
				return handle(usersCreateHandler(req, ctx));
			}
			if (seg2 && isUuid(seg2) && seg3 === "update" && !seg4) {
				return handle(usersUpdateHandler(req, ctx, PrincipalId(seg2)));
			}
			if (seg2 && isUuid(seg2) && seg3 === "delete" && !seg4) {
				return handle(usersDeleteHandler(req, ctx, PrincipalId(seg2)));
			}
			if (seg2 && isUuid(seg2) && seg3 === "set-password" && !seg4) {
				return handle(usersSetPasswordHandler(req, ctx, PrincipalId(seg2)));
			}
			if (seg2 && isUuid(seg2) && seg3 === "collections" && seg4 === "create") {
				return handle(
					usersCollectionsCreateHandler(req, ctx, PrincipalId(seg2)),
				);
			}
		}
		// Calendar bulk import
		if (
			seg1 === "calendar" &&
			seg2 &&
			isUuid(seg2) &&
			seg3 === "import" &&
			!seg4
		) {
			return handle(calendarImportHandler(req, ctx, CollectionId(seg2)));
		}
		// Calendar event mutations
		if (seg1 === "calendar" && seg2 && isUuid(seg2) && seg3 === "events") {
			if (seg4 === "create") {
				return handle(eventCreateHandler(req, ctx, CollectionId(seg2)));
			}
			if (seg4 && isUuid(seg4)) {
				const seg5 = segments[5];
				if (seg5 === "update") {
					return handle(eventUpdateHandler(req, ctx, InstanceId(seg4)));
				}
				if (seg5 === "delete") {
					return handle(eventDeleteHandler(req, ctx, InstanceId(seg4)));
				}
			}
		}
		// Task mutations
		if (seg1 === "tasks" && seg2 && isUuid(seg2) && seg3 === "tasks") {
			if (seg4 === "create") {
				return handle(taskCreateHandler(req, ctx, CollectionId(seg2)));
			}
			if (seg4 && isUuid(seg4)) {
				const seg5 = segments[5];
				if (seg5 === "update") {
					return handle(taskUpdateHandler(req, ctx, InstanceId(seg4)));
				}
				if (seg5 === "delete") {
					return handle(taskDeleteHandler(req, ctx, InstanceId(seg4)));
				}
				if (seg5 === "toggle") {
					return handle(taskToggleHandler(req, ctx, InstanceId(seg4)));
				}
			}
		}
		if (seg1 === "profile" && seg2 === "email-credentials") {
			if (seg3 === "save" && !seg4) {
				return handle(emailCredentialsSaveHandler(req, ctx));
			}
			if (seg3 === "clear" && !seg4) {
				return handle(emailCredentialsClearHandler(req, ctx));
			}
		}
		if (seg1 === "profile" && seg2 === "app-passwords") {
			if (seg3 === "create" && !seg4) {
				return handle(appPasswordsCreateHandler(req, ctx));
			}
			if (seg3 === "revoke" && !seg4) {
				return handle(appPasswordsRevokeHandler(req, ctx));
			}
		}
		if (seg1 === "contacts") {
			if (seg2 === "create" && !seg3) {
				return handle(contactsCreateHandler(req, ctx));
			}
			if (seg2 === "bulk-delete" && !seg3) {
				return handle(contactsBulkDeleteHandler(req, ctx));
			}
			if (seg2 === "bulk-clear-photo" && !seg3) {
				return handle(contactsBulkClearPhotoHandler(req, ctx));
			}
			if (seg2 === "bulk-download" && !seg3) {
				return handle(contactsBulkDownloadHandler(req, ctx));
			}
			if (seg2 === "export" && !seg3) {
				const bookId = ctx.url.searchParams.get("addressbook");
				if (bookId !== null && isUuid(bookId)) {
					return handle(
						contactsExportStartHandler(req, ctx, CollectionId(bookId)),
					);
				}
			}
			if (seg2 === "merge" && !seg3) {
				return handle(contactsMergeExecuteHandler(req, ctx));
			}
			if (seg2 === "cleanup" && seg3 === "fix" && !seg4) {
				return handle(contactsCleanupFixHandler(req, ctx));
			}
			if (seg2 === "cleanup" && seg3 === "fix-all" && !seg4) {
				return handle(contactsCleanupFixAllHandler(req, ctx));
			}
			if (seg2 && isUuid(seg2) && seg3 === "import" && !seg4) {
				return handle(contactsImportHandler(req, ctx, CollectionId(seg2)));
			}
			if (seg2 && isUuid(seg2) && seg3 === "update" && !seg4) {
				return handle(contactsUpdateHandler(req, ctx, InstanceId(seg2)));
			}
			if (seg2 && isUuid(seg2) && seg3 === "delete" && !seg4) {
				return handle(contactsDeleteHandler(req, ctx, InstanceId(seg2)));
			}
		}
		if (seg1 === "subscriptions") {
			if (seg2 === "create" && !seg3) {
				return handle(subscriptionsCreateHandler(req, ctx));
			}
			if (seg2 && isUuid(seg2) && seg3 === "delete" && !seg4) {
				return handle(subscriptionsDeleteHandler(req, ctx, seg2 as UuidString));
			}
		}
		if (seg1 === "feeds") {
			if (seg2 === "create" && !seg3) {
				return handle(feedsCreateHandler(req, ctx));
			}
			if (seg2 && isUuid(seg2) && seg3 === "update" && !seg4) {
				return handle(feedsUpdateHandler(req, ctx, seg2 as UuidString));
			}
			if (seg2 && isUuid(seg2) && seg3 === "delete" && !seg4) {
				return handle(feedsDeleteHandler(req, ctx, seg2 as UuidString));
			}
			if (seg2 && isUuid(seg2) && seg3 === "regenerate" && !seg4) {
				return handle(feedsRegenerateHandler(req, ctx, seg2 as UuidString));
			}
		}
		if (seg1 === "trash") {
			if (
				seg2 === "collections" &&
				seg3 &&
				isUuid(seg3) &&
				seg4 === "restore"
			) {
				return handle(
					trashRestoreCollectionHandler(req, ctx, CollectionId(seg3)),
				);
			}
			if (seg2 === "collections" && seg3 && isUuid(seg3) && seg4 === "purge") {
				return handle(
					trashPurgeCollectionHandler(req, ctx, CollectionId(seg3)),
				);
			}
			if (seg2 === "instances" && seg3 && isUuid(seg3) && seg4 === "restore") {
				return handle(trashRestoreInstanceHandler(req, ctx, InstanceId(seg3)));
			}
			if (seg2 === "instances" && seg3 && isUuid(seg3) && seg4 === "purge") {
				return handle(trashPurgeInstanceHandler(req, ctx, InstanceId(seg3)));
			}
		}
		if (seg1 === "groups") {
			if (seg2 === "create" && !seg3) {
				return handle(groupsCreateHandler(req, ctx));
			}
			if (seg2 && isUuid(seg2) && seg3 === "update" && !seg4) {
				return handle(groupsUpdateHandler(req, ctx, PrincipalId(seg2)));
			}
			if (seg2 && isUuid(seg2) && seg3 === "delete" && !seg4) {
				return handle(groupsDeleteHandler(req, ctx, PrincipalId(seg2)));
			}
			if (seg2 && isUuid(seg2) && seg3 === "members" && !seg4) {
				return handle(groupsMembersHandler(req, ctx, PrincipalId(seg2)));
			}
			if (seg2 && isUuid(seg2) && seg3 === "collections" && seg4 === "create") {
				return handle(
					groupsCollectionsCreateHandler(req, ctx, PrincipalId(seg2)),
				);
			}
		}
	}

	return notFound();
};
