import type { Effect } from "effect";
import { Context } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import type { CollectionId, InstanceId, PrincipalId } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import type { AclResourceType, NewAce } from "./repository.ts";

// ---------------------------------------------------------------------------
// AclResourceId — the UUID of the resource being access-checked.
//
// Callers extract this from their ResolvedDavPath (already slug-resolved):
//   principal   → principalId
//   collection  → collectionId
//   instance    → instanceId
// ---------------------------------------------------------------------------

export type AclResourceId = CollectionId | InstanceId | PrincipalId;

// ---------------------------------------------------------------------------
// AclService — RFC 3744 access control enforcement
//
// The primary gate for all DAV operations.  Every handler calls
// `AclService.check(principalId, resourceId, resourceType, privilege)` before
// proceeding. On failure it returns a `DavError` with "DAV:need-privileges".
// ---------------------------------------------------------------------------

export interface AclServiceShape {
	/**
	 * Check whether the given principal has the privilege on the resource.
	 * Returns `void` on success; fails with `davError(403, "DAV:need-privileges")`
	 * if the privilege is not granted.
	 *
	 * `resourceId` must be the UUID of the resource (not a URL path).
	 * `resourceType` distinguishes principal/collection/instance rows.
	 */
	readonly check: (
		principalId: PrincipalId,
		resourceId: AclResourceId,
		resourceType: AclResourceType,
		privilege: DavPrivilege,
	) => Effect.Effect<void, DavError | DatabaseError>;

	/**
	 * Return the set of privileges the principal currently has on the resource.
	 */
	readonly currentUserPrivileges: (
		principalId: PrincipalId,
		resourceId: AclResourceId,
		resourceType: AclResourceType,
	) => Effect.Effect<ReadonlyArray<DavPrivilege>, DatabaseError>;

	/**
	 * Replace all non-protected ACEs on a resource with the given list.
	 * Protected (server-managed) ACEs are preserved.
	 * Used by the ACL HTTP method handler (RFC 3744 §8.1).
	 */
	readonly setAces: (
		resourceId: AclResourceId,
		resourceType: AclResourceType,
		aces: ReadonlyArray<NewAce>,
	) => Effect.Effect<void, DatabaseError>;
}

export class AclService extends Context.Tag("AclService")<
	AclService,
	AclServiceShape
>() {}
