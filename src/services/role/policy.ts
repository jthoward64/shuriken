import type { ResourceType } from "#src/db/drizzle/schema/index.ts";
import type { UuidString } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import {
	GROUPS_VIRTUAL_RESOURCE_ID,
	USERS_VIRTUAL_RESOURCE_ID,
} from "#src/domain/virtual-resources.ts";

// ---------------------------------------------------------------------------
// RolePolicy — single source of truth for what each role grants.
//
// The user's `role` column is free-form text so future roles don't require a
// schema migration. This module narrows it to the known set and exposes:
//
//   * `bypassesAclCheck(role)` — true when the role short-circuits any
//     privilege check (super_admin). Use sparingly; the rest of the
//     authorization model still applies for everyone else.
//   * `virtualGrants(role)` — list of (resource, privilege) pairs the
//     ProvisioningService should grant when a user is created or promoted.
//     Idempotent — re-applying the same role does nothing.
//
// Adding a new role:
//   1. Append the literal to `KNOWN_ROLES`.
//   2. Add an entry to `VIRTUAL_GRANTS` (and/or set `bypass: true` in
//      ROLE_BYPASS).
//   3. (optional) Add a UI option in the user-edit role dropdown.
// No schema changes needed.
// ---------------------------------------------------------------------------

export const KNOWN_ROLES = ["normal", "admin", "super_admin"] as const;
export type Role = (typeof KNOWN_ROLES)[number];
export const DEFAULT_ROLE: Role = "normal";

export const isKnownRole = (raw: string): raw is Role =>
	(KNOWN_ROLES as ReadonlyArray<string>).includes(raw);

export const normaliseRole = (raw: string): Role =>
	isKnownRole(raw) ? raw : DEFAULT_ROLE;

// Roles that short-circuit all privilege checks.
const ROLE_BYPASS: Readonly<Record<Role, boolean>> = {
	normal: false,
	admin: false,
	super_admin: true,
};

export const bypassesAclCheck = (role: string): boolean =>
	ROLE_BYPASS[normaliseRole(role)];

// Virtual-resource ACEs each role gets when provisioned. `super_admin` lists
// the same admin grants for parity even though `bypassesAclCheck` short-
// circuits — keeps PROPFIND DAV:acl read-outs intuitive.
const VIRTUAL_GRANTS: Readonly<
	Record<
		Role,
		ReadonlyArray<{
			readonly resourceId: UuidString;
			readonly resourceType: ResourceType;
			readonly privilege: DavPrivilege;
		}>
	>
> = {
	normal: [],
	admin: [
		{
			resourceId: USERS_VIRTUAL_RESOURCE_ID,
			resourceType: "virtual",
			privilege: "DAV:all",
		},
		{
			resourceId: GROUPS_VIRTUAL_RESOURCE_ID,
			resourceType: "virtual",
			privilege: "DAV:all",
		},
	],
	super_admin: [
		{
			resourceId: USERS_VIRTUAL_RESOURCE_ID,
			resourceType: "virtual",
			privilege: "DAV:all",
		},
		{
			resourceId: GROUPS_VIRTUAL_RESOURCE_ID,
			resourceType: "virtual",
			privilege: "DAV:all",
		},
	],
};

export const virtualGrants = (role: string) =>
	VIRTUAL_GRANTS[normaliseRole(role)];
