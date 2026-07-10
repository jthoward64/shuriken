import type { DavPrivilege } from "#src/domain/types/dav.ts";

// ---------------------------------------------------------------------------
// Any of these privileges on a resource qualifies it as "shared with me".
// DAV:read is the common case; DAV:all and DAV:write imply read.
// ---------------------------------------------------------------------------

export const SHARED_READ_PRIVILEGES: ReadonlyArray<DavPrivilege> = [
	"DAV:read",
	"DAV:all",
	"DAV:write",
	// Free-busy-only grants are calendar-only and never imply full read, but
	// they still qualify a calendar as "shared with me" for the sidebar list —
	// callers must redact event details themselves (see calendar/events.ts).
	"CALDAV:read-free-busy",
];
