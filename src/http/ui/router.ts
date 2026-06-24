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
	HTTP_INTERNAL_SERVER_ERROR,
	HTTP_NOT_FOUND,
	HTTP_OK,
	HTTP_SEE_OTHER,
	HTTP_UNAUTHORIZED,
} from "#src/http/status.ts";
import { aclGrantHandler } from "#src/http/ui/api/acl/grant.ts";
import { aclRevokeHandler } from "#src/http/ui/api/acl/revoke.ts";
import {
	eventCreateHandler,
	eventDeleteHandler,
	eventUpdateHandler,
} from "#src/http/ui/api/calendar/event-write.ts";
import { calendarEventsHandler } from "#src/http/ui/api/calendar/events.ts";
import { calendarImportHandler } from "#src/http/ui/api/calendar/import.ts";
import { collectionsDeleteHandler } from "#src/http/ui/api/collections/delete.ts";
import { collectionsUpdateHandler } from "#src/http/ui/api/collections/update.ts";
import { contactsCreateHandler } from "#src/http/ui/api/contacts/create.ts";
import { contactsDeleteHandler } from "#src/http/ui/api/contacts/delete.ts";
import { contactsImportHandler } from "#src/http/ui/api/contacts/import.ts";
import { contactsUpdateHandler } from "#src/http/ui/api/contacts/update.ts";
import { feedsCreateHandler } from "#src/http/ui/api/feeds/create.ts";
import { feedsDeleteHandler } from "#src/http/ui/api/feeds/delete.ts";
import { feedsRegenerateHandler } from "#src/http/ui/api/feeds/regenerate.ts";
import { feedsUpdateHandler } from "#src/http/ui/api/feeds/update.ts";
import { groupsCreateHandler } from "#src/http/ui/api/groups/create.ts";
import { groupsCollectionsCreateHandler } from "#src/http/ui/api/groups/create-collection.ts";
import { groupsDeleteHandler } from "#src/http/ui/api/groups/delete.ts";
import { groupsMembersHandler } from "#src/http/ui/api/groups/members.ts";
import { groupsUpdateHandler } from "#src/http/ui/api/groups/update.ts";
import { emailCredentialsClearHandler } from "#src/http/ui/api/profile/email-credentials-clear.ts";
import { emailCredentialsSaveHandler } from "#src/http/ui/api/profile/email-credentials-save.ts";
import { subscriptionsCreateHandler } from "#src/http/ui/api/subscriptions/create.ts";
import { subscriptionsDeleteHandler } from "#src/http/ui/api/subscriptions/delete.ts";
import { usersCreateHandler } from "#src/http/ui/api/users/create.ts";
import { usersCollectionsCreateHandler } from "#src/http/ui/api/users/create-collection.ts";
import { usersDeleteHandler } from "#src/http/ui/api/users/delete.ts";
import { usersSetPasswordHandler } from "#src/http/ui/api/users/set-password.ts";
import { usersUpdateHandler } from "#src/http/ui/api/users/update.ts";
import { eventEditHandler } from "#src/http/ui/handlers/calendar/event-edit.ts";
import { eventNewHandler } from "#src/http/ui/handlers/calendar/event-new.ts";
import { calendarExportHandler } from "#src/http/ui/handlers/calendar/export.ts";
import { calendarViewHandler } from "#src/http/ui/handlers/calendar/view.ts";
import { collectionsEditHandler } from "#src/http/ui/handlers/collections/edit.ts";
import { contactsEditHandler } from "#src/http/ui/handlers/contacts/edit.ts";
import { contactsExportHandler } from "#src/http/ui/handlers/contacts/export.ts";
import { contactsListHandler } from "#src/http/ui/handlers/contacts/list.ts";
import { contactsNewHandler } from "#src/http/ui/handlers/contacts/new.ts";
import { feedsEditHandler } from "#src/http/ui/handlers/feeds/edit.ts";
import { feedsListHandler } from "#src/http/ui/handlers/feeds/list.ts";
import { feedsNewHandler } from "#src/http/ui/handlers/feeds/new.ts";
import { groupsCollectionsNewHandler } from "#src/http/ui/handlers/groups/collections-new.ts";
import { groupsEditHandler } from "#src/http/ui/handlers/groups/edit.ts";
import { groupsListHandler } from "#src/http/ui/handlers/groups/list.ts";
import { groupsNewHandler } from "#src/http/ui/handlers/groups/new.ts";
import { instanceAclHandler } from "#src/http/ui/handlers/instances/acl.ts";
import { emailCredentialsPageHandler } from "#src/http/ui/handlers/profile/email-credentials.ts";
import { sharedWithMeHandler } from "#src/http/ui/handlers/shared/index.ts";
import { staticHandler } from "#src/http/ui/handlers/static.ts";
import { subscriptionsListHandler } from "#src/http/ui/handlers/subscriptions/list.ts";
import { subscriptionsNewHandler } from "#src/http/ui/handlers/subscriptions/new.ts";
import { usersCollectionsNewHandler } from "#src/http/ui/handlers/users/collections-new.ts";
import { usersEditHandler } from "#src/http/ui/handlers/users/edit.ts";
import { usersListHandler } from "#src/http/ui/handlers/users/list.ts";
import { usersNewHandler } from "#src/http/ui/handlers/users/new.ts";
import type { FileService } from "#src/platform/file.ts";
import type { AclService } from "#src/services/acl/index.ts";
import type { AclRepository } from "#src/services/acl/repository.ts";
import type { CalEditService } from "#src/services/cal-edit/service.ts";
import type { CardEditService } from "#src/services/card-edit/service.ts";
import type { CardIndexRepository } from "#src/services/card-index/repository.ts";
import type { CollectionService } from "#src/services/collection/index.ts";
import type { CollectionRepository } from "#src/services/collection/repository.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { UserEmailCredentialRepository } from "#src/services/email-credential/repository.ts";
import type { EmailCredentialService } from "#src/services/email-credential/service.ts";
import type { EntityRepository } from "#src/services/entity/index.ts";
import type { ExternalCalendarRepository } from "#src/services/external-calendar/repository.ts";
import type { SubscriptionService } from "#src/services/external-calendar/subscription.ts";
import type { GroupService } from "#src/services/group/index.ts";
import type { ImipDispatchService } from "#src/services/imip/dispatch.ts";
import type { InstanceService } from "#src/services/instance/index.ts";
import type { InstanceRepository } from "#src/services/instance/repository.ts";
import type { PrincipalService } from "#src/services/principal/index.ts";
import type { PrincipalRepository } from "#src/services/principal/repository.ts";
import type { ProvisioningService } from "#src/services/provisioning/service.ts";
import type { ShareLinkService } from "#src/services/share-link/service.ts";
import type { UserService } from "#src/services/user/index.ts";
import { profileHandler } from "./handlers/profile.ts";
import { renderError } from "./helpers/render-page.ts";
import type { TemplateService } from "./template/index.ts";

// ---------------------------------------------------------------------------
// UI service union — all services the UI router and its handlers can use
// ---------------------------------------------------------------------------

export type UiServices =
	| AppConfigService
	| AclRepository
	| AclService
	| FileService
	| CalEditService
	| CardEditService
	| DatabaseClient
	| EmailCredentialService
	| EntityRepository
	| ImipDispatchService
	| UserEmailCredentialRepository
	| CardIndexRepository
	| CollectionRepository
	| CollectionService
	| ComponentRepository
	| ExternalCalendarRepository
	| GroupService
	| InstanceRepository
	| InstanceService
	| SubscriptionService
	| PrincipalRepository
	| PrincipalService
	| ProvisioningService
	| ShareLinkService
	| TemplateService
	| UserService;

// ---------------------------------------------------------------------------
// Error → Response mapping for UI errors
// ---------------------------------------------------------------------------

type UiError = DavError | DatabaseError | InternalError | ConflictError;

const mapUiError = (
	err: UiError,
	ctx: HttpRequestContext,
	basicAuthEnabled: boolean,
): Effect.Effect<Response, never, TemplateService> =>
	Match.value(err).pipe(
		Match.tag("DavError", (e) => {
			if (e.status === HTTP_UNAUTHORIZED) {
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
				return renderError(
					HTTP_FORBIDDEN,
					"pages/errors/403",
					{ pageTitle: "Forbidden" },
					ctx.headers,
				).pipe(
					Effect.catch(() =>
						Effect.succeed(
							new Response("Forbidden", { status: HTTP_FORBIDDEN }),
						),
					),
				);
			}
			if (e.status === HTTP_NOT_FOUND) {
				return renderError(
					HTTP_NOT_FOUND,
					"pages/errors/404",
					{ pageTitle: "Not Found" },
					ctx.headers,
				).pipe(
					Effect.catch(() =>
						Effect.succeed(
							new Response("Not Found", { status: HTTP_NOT_FOUND }),
						),
					),
				);
			}
			return Effect.succeed(
				new Response(e.message ?? "Error", { status: e.status }),
			);
		}),
		Match.tag("DatabaseError", "InternalError", (e) =>
			Effect.logError("ui handler failed", {
				cause: (e as { cause: unknown }).cause,
			}).pipe(
				Effect.andThen(
					renderError(
						HTTP_INTERNAL_SERVER_ERROR,
						"pages/errors/500",
						{ pageTitle: "Server Error" },
						ctx.headers,
					).pipe(
						Effect.catch(() =>
							Effect.succeed(
								new Response("Internal Server Error", {
									status: HTTP_INTERNAL_SERVER_ERROR,
								}),
							),
						),
					),
				),
			),
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
					mapUiError(err, ctx, config.auth.basicAuthEnabled),
				),
			);
		});

	const notFound = (): Effect.Effect<Response, never, UiServices> =>
		renderError(
			HTTP_NOT_FOUND,
			"pages/errors/404",
			{ pageTitle: "Not Found" },
			ctx.headers,
		).pipe(
			Effect.catch(() =>
				Effect.succeed(new Response("Not Found", { status: HTTP_NOT_FOUND })),
			),
		);

	// Home
	if (!seg0 && method === "GET") {
		return handle(
			renderError(HTTP_OK, "pages/home", { pageTitle: "Home" }, ctx.headers),
		);
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

	// Shared-with-me landing
	if (seg0 === "shared" && method === "GET" && !seg1) {
		return handle(sharedWithMeHandler(req, ctx));
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
		if (seg1 && isUuid(seg1) && seg2 === "events" && seg3 === "new" && !seg4) {
			return handle(eventNewHandler(req, ctx, CollectionId(seg1)));
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

	// Contacts (GET pages)
	if (seg0 === "contacts" && method === "GET") {
		if (!seg1) {
			return handle(contactsListHandler(req, ctx));
		}
		if (seg1 === "new" && !seg2) {
			return handle(contactsNewHandler(req, ctx));
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
			if (seg2 && isUuid(seg2) && seg3 === "update" && !seg4) {
				return handle(collectionsUpdateHandler(req, ctx, CollectionId(seg2)));
			}
			if (seg2 && isUuid(seg2) && seg3 === "delete" && !seg4) {
				return handle(collectionsDeleteHandler(req, ctx, CollectionId(seg2)));
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
		if (seg1 === "profile" && seg2 === "email-credentials") {
			if (seg3 === "save" && !seg4) {
				return handle(emailCredentialsSaveHandler(req, ctx));
			}
			if (seg3 === "clear" && !seg4) {
				return handle(emailCredentialsClearHandler(req, ctx));
			}
		}
		if (seg1 === "contacts") {
			if (seg2 === "create" && !seg3) {
				return handle(contactsCreateHandler(req, ctx));
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
