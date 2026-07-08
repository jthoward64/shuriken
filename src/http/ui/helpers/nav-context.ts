import { Effect, Option } from "effect";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { AuthenticatedPrincipal } from "#src/domain/types/dav.ts";
import {
	GROUPS_VIRTUAL_RESOURCE_ID,
	USERS_VIRTUAL_RESOURCE_ID,
} from "#src/domain/virtual-resources.ts";
import { AclService } from "#src/services/acl/index.ts";

// ---------------------------------------------------------------------------
// NavContext — passed to every page template to drive navigation rendering
// ---------------------------------------------------------------------------

// The highlighted top-level nav area for the current page. Subscriptions and
// Feeds live under the Calendar menu (both are calendar-scoped), so they map to
// "calendar"; Users/Groups map to "admin".
export type NavSection =
	| "home"
	| "calendar"
	| "tasks"
	| "contacts"
	| "trash"
	| "admin"
	| "profile";

export interface NavContext {
	readonly showUsers: boolean;
	readonly showGroups: boolean;
	/** Users or Groups visible — drives the Admin menu. */
	readonly showAdmin: boolean;
	readonly showSubscriptions: boolean;
	readonly showContacts: boolean;
	readonly showCalendar: boolean;
	readonly showTasks: boolean;
	readonly showFeeds: boolean;
	/** Trash bin — every authenticated user has one, so this is always true. */
	readonly showTrash: boolean;
	readonly showLogout: boolean;
	readonly currentPath: string;
	readonly activeSection: NavSection | undefined;
	readonly displayName: string | undefined;
}

// Map a UI path to the nav area it belongs to, for active-state highlighting.
const sectionForPath = (path: string): NavSection | undefined => {
	if (path === "/ui" || path === "/ui/" || path === "/") {
		return "home";
	}
	if (
		path.startsWith("/ui/calendar") ||
		path.startsWith("/ui/subscriptions") ||
		path.startsWith("/ui/feeds")
	) {
		return "calendar";
	}
	if (path.startsWith("/ui/tasks")) {
		return "tasks";
	}
	if (path.startsWith("/ui/contacts")) {
		return "contacts";
	}
	if (path.startsWith("/ui/trash")) {
		return "trash";
	}
	if (path.startsWith("/ui/users") || path.startsWith("/ui/groups")) {
		return "admin";
	}
	if (path.startsWith("/ui/profile")) {
		return "profile";
	}
	return undefined;
};

export const buildNavContext = (
	principal: AuthenticatedPrincipal,
	currentPath: string,
	basicAuthEnabled: boolean,
): Effect.Effect<NavContext, DatabaseError, AclService> =>
	Effect.gen(function* () {
		const acl = yield* AclService;

		const [usersPrivs, groupsPrivs] = yield* Effect.all([
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

		return {
			showUsers: usersPrivs.includes("DAV:read"),
			showGroups: groupsPrivs.includes("DAV:read"),
			showAdmin:
				usersPrivs.includes("DAV:read") || groupsPrivs.includes("DAV:read"),
			showSubscriptions: true,
			showContacts: true,
			showCalendar: true,
			showTasks: true,
			showFeeds: true,
			showTrash: true,
			showLogout: basicAuthEnabled,
			currentPath,
			activeSection: sectionForPath(currentPath),
			displayName: Option.getOrUndefined(principal.displayName),
		};
	});
