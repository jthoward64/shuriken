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

export interface NavContext {
	readonly showUsers: boolean;
	readonly showGroups: boolean;
	readonly showLogout: boolean;
	readonly currentPath: string;
	readonly displayName: string | undefined;
}

export const buildNavContext = (
	principal: AuthenticatedPrincipal,
	currentPath: string,
	authMode: "single-user" | "basic" | "proxy",
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
			showLogout: authMode === "basic",
			currentPath,
			displayName: Option.getOrUndefined(principal.displayName),
		};
	});
