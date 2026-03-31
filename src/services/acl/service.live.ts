import { Effect, Layer } from "effect";
import type { PrincipalId } from "#src/domain/ids.ts";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import { AclRepository } from "./repository.ts";
import { AclService } from "./service.ts";

// ---------------------------------------------------------------------------
// AclService — stub live implementation
//
// Full RFC 3744 evaluation (inherited ACLs, privilege aggregation, principal
// expansion for DAV:all / DAV:authenticated / groups) is a future milestone.
// This stub grants all privileges to keep the scaffold runnable, and provides
// the correct error shape for the deny path.
// ---------------------------------------------------------------------------

export const AclServiceLive = Layer.effect(
	AclService,
	Effect.gen(function* () {
		const _repo = yield* AclRepository;

		return AclService.of({
			check: (
				_principalId: PrincipalId,
				_resourceUrl: string,
				_privilege: DavPrivilege,
			) =>
				// TODO: implement RFC 3744 evaluation using casbin_rule table
				Effect.void,

			currentUserPrivileges: (
				_principalId: PrincipalId,
				_resourceUrl: string,
			) =>
				// TODO: return evaluated privilege set from casbin_rule table
				Effect.succeed([
					"DAV:read",
					"DAV:write",
					"DAV:write-properties",
					"DAV:write-content",
					"DAV:read-acl",
					"DAV:read-current-user-privilege-set",
					"DAV:write-acl",
					"DAV:bind",
					"DAV:unbind",
				] satisfies Array<DavPrivilege>),
		});
	}),
);

// Export the error helper for use by handlers calling check()
export { needPrivileges } from "#src/domain/errors.ts";
