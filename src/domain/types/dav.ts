import { Data, type Option } from "effect";
import type { PrincipalId, UserId } from "#src/domain/ids.ts";

export type {
	CollectionType,
	ContentType,
	EntityType,
	PrincipalKind as PrincipalType,
} from "#src/db/drizzle/schema/index.ts";

// ---------------------------------------------------------------------------
// HTTP methods used in DAV
// ---------------------------------------------------------------------------

export type DavMethod =
	| "OPTIONS"
	| "GET"
	| "HEAD"
	| "PUT"
	| "DELETE"
	| "POST"
	| "PROPFIND"
	| "PROPPATCH"
	| "MKCOL"
	| "COPY"
	| "MOVE"
	| "LOCK"
	| "UNLOCK"
	| "REPORT"
	| "MKCALENDAR"
	| "MKADDRESSBOOK"
	| "ACL";

// ---------------------------------------------------------------------------
// DAV capability classes (reported in DAV: response header)
// ---------------------------------------------------------------------------

export type DavCapabilityClass =
	| "1"
	| "2"
	| "3"
	| "calendar-access"
	| "addressbook"
	| "extended-mkcol";

// ---------------------------------------------------------------------------
// Authenticated principal — produced by AuthService, consumed by services
// ---------------------------------------------------------------------------

export interface AuthenticatedPrincipal {
	readonly principalId: PrincipalId;
	readonly userId: UserId;
	readonly displayName: Option.Option<string>;
}

// ---------------------------------------------------------------------------
// AuthResult — union produced by the auth middleware
// Defined here (not in auth/) so services can use it without depending on auth/
// ---------------------------------------------------------------------------

export class Authenticated extends Data.TaggedClass("Authenticated")<{
	readonly principal: AuthenticatedPrincipal;
}> {}

export class Unauthenticated extends Data.TaggedClass("Unauthenticated")<
	Record<never, never>
> {}

export type AuthResult = Authenticated | Unauthenticated;

// ---------------------------------------------------------------------------
// DAV privilege names (RFC 3744 + CalDAV + CardDAV)
// ---------------------------------------------------------------------------

export type DavPrivilege =
	// RFC 4918 / 3744 core
	| "DAV:read"
	| "DAV:write"
	| "DAV:write-properties"
	| "DAV:write-content"
	| "DAV:unlock"
	| "DAV:read-acl"
	| "DAV:read-current-user-privilege-set"
	| "DAV:write-acl"
	| "DAV:bind"
	| "DAV:unbind"
	| "DAV:all"
	// CalDAV scheduling
	| "CALDAV:schedule-deliver"
	| "CALDAV:schedule-deliver-invite"
	| "CALDAV:schedule-deliver-reply"
	| "CALDAV:schedule-query-freebusy"
	| "CALDAV:schedule-send"
	| "CALDAV:schedule-send-invite"
	| "CALDAV:schedule-send-reply"
	| "CALDAV:schedule-send-freebusy";
