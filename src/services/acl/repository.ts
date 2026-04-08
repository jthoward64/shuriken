import type { InferSelectModel } from "drizzle-orm";
import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { davAcl } from "#src/db/drizzle/schema/index.ts";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { PrincipalId, UuidString } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";

// ---------------------------------------------------------------------------
// AclRepository — data access for dav_acl rows
//
// Resource types:  'collection' | 'instance' | 'principal'
// Principal types: 'principal' | 'all' | 'authenticated' | 'unauthenticated' | 'self'
//
// Privilege evaluation order:
//   1. For a check, the caller passes all principal IDs for the user (own + groups).
//   2. The repository checks for any matching grant ACE (privilege expanded to
//      its containers by the caller, e.g. DAV:write-content → [DAV:write-content, DAV:write, DAV:all]).
//   3. Inherited ACEs are not stored here; walking the collection hierarchy
//      is the responsibility of the service layer.
// ---------------------------------------------------------------------------

export type AceRow = InferSelectModel<typeof davAcl>;

export type AclResourceType = "collection" | "instance" | "principal";

export interface NewAce {
	readonly resourceType: AclResourceType;
	readonly resourceId: UuidString;
	readonly principalType:
		| "principal"
		| "all"
		| "authenticated"
		| "unauthenticated"
		| "self";
	readonly principalId?: UuidString;
	readonly privilege: DavPrivilege;
	readonly grantDeny: "grant" | "deny";
	readonly protected: boolean;
	readonly ordinal: number;
}

export interface AclRepositoryShape {
	/** All ACEs for a resource, ordered by ordinal. Used for PROPFIND DAV:acl. */
	readonly getAces: (
		resourceId: UuidString,
		resourceType: AclResourceType,
	) => Effect.Effect<ReadonlyArray<AceRow>, DatabaseError>;

	/** Replace all non-protected ACEs on a resource. Used by the ACL method. */
	readonly setAces: (
		resourceId: UuidString,
		resourceType: AclResourceType,
		aces: ReadonlyArray<NewAce>,
	) => Effect.Effect<void, DatabaseError>;

	/** Insert a single ACE. Used during resource provisioning. */
	readonly grantAce: (ace: NewAce) => Effect.Effect<void, DatabaseError>;

	/**
	 * Check whether any of the given principal IDs has one of the given privileges
	 * on the resource. The caller is responsible for:
	 *   - Including the user's own principal ID plus all their group principal IDs.
	 *   - Expanding the target privilege to all aggregate privileges that contain it.
	 */
	readonly hasPrivilege: (
		principalIds: ReadonlyArray<PrincipalId>,
		resourceId: UuidString,
		resourceType: AclResourceType,
		privileges: ReadonlyArray<DavPrivilege>,
		isAuthenticated: boolean,
	) => Effect.Effect<boolean, DatabaseError>;

	/**
	 * Return all privileges explicitly granted to any of the given principals on
	 * the resource. The caller resolves group membership before calling.
	 */
	readonly getGrantedPrivileges: (
		principalIds: ReadonlyArray<PrincipalId>,
		resourceId: UuidString,
		resourceType: AclResourceType,
		isAuthenticated: boolean,
	) => Effect.Effect<ReadonlyArray<DavPrivilege>, DatabaseError>;

	/**
	 * Get the principal IDs of all groups the given user principal belongs to.
	 * Used by the service to expand the principal set before privilege checks.
	 */
	readonly getGroupPrincipalIds: (
		userPrincipalId: PrincipalId,
	) => Effect.Effect<ReadonlyArray<PrincipalId>, DatabaseError>;

	/**
	 * Return the immediate ACL-inheritance parent of a resource, used by the
	 * service to walk the hierarchy when no direct ACE matches.
	 *
	 * - instance  → its collection
	 * - collection with parent_collection_id → that parent collection
	 * - collection without parent → its owner principal
	 * - principal → None (top of the hierarchy)
	 */
	readonly getResourceParent: (
		resourceId: UuidString,
		resourceType: AclResourceType,
	) => Effect.Effect<
		Option.Option<{ readonly id: UuidString; readonly type: AclResourceType }>,
		DatabaseError
	>;
}

export class AclRepository extends Context.Tag("AclRepository")<
	AclRepository,
	AclRepositoryShape
>() {}
