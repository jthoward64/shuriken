import { Effect, Layer } from "effect";
import type { DavPrivilege } from "#src/domain/types/dav.ts";
import { AclService } from "./service.ts";

// ---------------------------------------------------------------------------
// AclServiceAllowAll — allow-all stub for use during handler development.
//
// Every check() call succeeds unconditionally; currentUserPrivileges() returns
// every defined DavPrivilege. Swap back to withInfra(AclDomainLayer) in
// src/layers.ts once ACL enforcement is wired into handlers.
// ---------------------------------------------------------------------------

const ALL_PRIVILEGES: ReadonlyArray<DavPrivilege> = [
	// RFC 4918 / 3744 core
	"DAV:read",
	"DAV:write",
	"DAV:write-properties",
	"DAV:write-content",
	"DAV:unlock",
	"DAV:read-acl",
	"DAV:read-current-user-privilege-set",
	"DAV:write-acl",
	"DAV:bind",
	"DAV:unbind",
	"DAV:all",
	// CalDAV scheduling
	"CALDAV:schedule-deliver",
	"CALDAV:schedule-deliver-invite",
	"CALDAV:schedule-deliver-reply",
	"CALDAV:schedule-query-freebusy",
	"CALDAV:schedule-send",
	"CALDAV:schedule-send-invite",
	"CALDAV:schedule-send-reply",
	"CALDAV:schedule-send-freebusy",
];

export const AclServiceAllowAll = Layer.succeed(
	AclService,
	AclService.of({
		check: (_principalId, _resourceId, _resourceType, _privilege) => Effect.void,
		currentUserPrivileges: (_principalId, _resourceId, _resourceType) =>
			Effect.succeed(ALL_PRIVILEGES),
	}),
);
