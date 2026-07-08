import type { Effect } from "effect";
import { Context } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import type {
	CollectionId,
	InstanceId,
	PrincipalId,
	VirtualResourceId,
} from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import type { AceRow, AclResourceType, NewAce } from "./repository.ts";

export type { AclResourceType } from "./repository.ts";

// ---------------------------------------------------------------------------
// AclResourceId — the UUID of the resource being access-checked.
//
// Callers extract this from their ResolvedDavPath (already slug-resolved):
//   principal   → principalId
//   collection  → collectionId
//   instance    → instanceId
// ---------------------------------------------------------------------------

export type AclResourceId =
	| CollectionId
	| InstanceId
	| PrincipalId
	| VirtualResourceId;

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
	 * Return all ACEs for the resource, ordered by ordinal.
	 * Used by PROPFIND to expose DAV:acl (RFC 3744 §5.5).
	 * Callers must hold DAV:read-acl before surfacing this to clients.
	 */
	readonly getAces: (
		resourceId: AclResourceId,
		resourceType: AclResourceType,
	) => Effect.Effect<ReadonlyArray<AceRow>, DatabaseError>;

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

	/**
	 * Batch version of currentUserPrivileges. Returns a map from resource ID to
	 * the expanded privilege set the caller holds on each resource. Resources
	 * where the caller has no privileges are absent from the map. No ancestor
	 * chain walking — direct ACEs only (suitable for virtual resource checks).
	 */
	readonly batchCurrentUserPrivileges: (
		principalId: PrincipalId,
		resourceIds: ReadonlyArray<AclResourceId>,
		resourceType: AclResourceType,
	) => Effect.Effect<
		ReadonlyMap<AclResourceId, ReadonlyArray<DavPrivilege>>,
		DatabaseError
	>;

	/**
	 * Effective privileges for many sibling members that all share the same
	 * parent resource (e.g. every instance in one collection), in a bounded
	 * number of queries instead of one ancestor walk per member.
	 *
	 * The inherited set — the parent's effective privileges — is resolved once,
	 * then unioned with each member's own direct ACEs (fetched in a single batch
	 * query). This is exactly equivalent to calling currentUserPrivileges() on
	 * each member, since a member's effective privileges are its direct ACEs
	 * unioned with its parent's effective privileges. Like currentUserPrivileges,
	 * it does **not** apply role-based bypass.
	 *
	 * Returns a map covering every memberId; members with only inherited
	 * privileges are present with the inherited set.
	 */
	readonly batchMemberPrivileges: (
		principalId: PrincipalId,
		parentId: AclResourceId,
		parentType: AclResourceType,
		memberIds: ReadonlyArray<AclResourceId>,
		memberType: AclResourceType,
	) => Effect.Effect<
		ReadonlyMap<AclResourceId, ReadonlyArray<DavPrivilege>>,
		DatabaseError
	>;

	/**
	 * Batched privilege check for sibling members sharing one parent: returns the
	 * subset of `memberIds` on which the principal holds `privilege`. Equivalent
	 * to calling check() per member (including the super_admin role bypass and
	 * ancestor inheritance) but in a bounded number of queries. Use at the edge
	 * to authorize a list of members without an N-query loop.
	 */
	readonly batchCheckMembers: (
		principalId: PrincipalId,
		parentId: AclResourceId,
		parentType: AclResourceType,
		memberIds: ReadonlyArray<AclResourceId>,
		memberType: AclResourceType,
		privilege: DavPrivilege,
	) => Effect.Effect<ReadonlySet<AclResourceId>, DatabaseError>;
}

export class AclService extends Context.Service<AclService, AclServiceShape>()(
	"AclService",
) {}
