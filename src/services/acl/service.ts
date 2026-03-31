import type { Effect } from "effect";
import { Context } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import type { PrincipalId } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";

// ---------------------------------------------------------------------------
// AclService — RFC 3744 access control enforcement
//
// The primary gate for all DAV operations.  Every handler calls
// `AclService.check(principalId, resourceUrl, privilege)` before proceeding.
// On failure it returns a `DavError` with precondition "DAV:need-privileges".
// ---------------------------------------------------------------------------

export interface AclServiceShape {
	/**
	 * Check whether the given principal has the privilege on the resource.
	 * Returns `void` on success; fails with `davError(403, "DAV:need-privileges")`
	 * if the privilege is not granted.
	 */
	readonly check: (
		principalId: PrincipalId,
		resourceUrl: string,
		privilege: DavPrivilege,
	) => Effect.Effect<void, DavError | DatabaseError>;

	/**
	 * Return the set of privileges the principal currently has on the resource.
	 */
	readonly currentUserPrivileges: (
		principalId: PrincipalId,
		resourceUrl: string,
	) => Effect.Effect<ReadonlyArray<DavPrivilege>, DatabaseError>;
}

export class AclService extends Context.Tag("AclService")<
	AclService,
	AclServiceShape
>() {}
