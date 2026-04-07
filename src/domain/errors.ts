import { Data, Effect, Option } from "effect";
import {
	HTTP_BAD_REQUEST,
	HTTP_CONFLICT,
	HTTP_FORBIDDEN,
	HTTP_METHOD_NOT_ALLOWED,
	HTTP_NOT_FOUND,
	HTTP_PRECONDITION_FAILED,
	HTTP_UNSUPPORTED_MEDIA_TYPE,
	type HttpStatus,
} from "#src/http/status.ts";

// ---------------------------------------------------------------------------
// Infrastructure errors — typed, non-DAV
// ---------------------------------------------------------------------------

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
	readonly cause: unknown;
}> {}

export class AuthError extends Data.TaggedError("AuthError")<{
	readonly reason: string;
}> {}

export class XmlParseError extends Data.TaggedError("XmlParseError")<{
	readonly cause: unknown;
}> {}

export class InternalError extends Data.TaggedError("InternalError")<{
	readonly cause: unknown;
}> {}

export class ConfigError extends Data.TaggedError("ConfigError")<{
	readonly key: string;
}> {}

/**
 * A unique constraint violation that the caller can meaningfully distinguish
 * from a general database error (e.g. "duplicate email" vs "connection lost").
 * Maps to PostgreSQL error code 23505.
 */
export class ConflictError extends Data.TaggedError("ConflictError")<{
	readonly field: string;
	readonly message: string;
}> {}

/**
 * Returns true when an error (or any nested `cause`) has PostgreSQL error code
 * 23505 (unique-constraint violation).
 *
 * Drizzle wraps driver errors in `DrizzleQueryError`, so the PG error code
 * lives at `e.cause.code`, not directly on `e`. We recurse one level to
 * handle both shapes:
 *   - Direct PG error:        { code: "23505", ... }
 *   - Drizzle-wrapped error:  { cause: { code: "23505", ... }, ... }
 */
export const isPgUniqueViolation = (cause: unknown): boolean => {
	if (
		typeof cause === "object" &&
		cause !== null &&
		"code" in cause &&
		(cause as { code: unknown }).code === "23505"
	) {
		return true;
	}
	if (
		typeof cause === "object" &&
		cause !== null &&
		"cause" in cause
	) {
		return isPgUniqueViolation((cause as { cause: unknown }).cause);
	}
	return false;
};

// ---------------------------------------------------------------------------
// DAV precondition / postcondition XML element names (per RFC)
// Format: "<NS-PREFIX>:<local-name>" where NS-PREFIX identifies the namespace.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// DAV precondition / postcondition XML element names (per RFC)
//
// Template literal types enforce the namespace prefix at compile time:
//   "DAV:..."      → WebDAV (RFC 4918) and ACL (RFC 3744) namespaced errors
//   "CALDAV:..."   → CalDAV (RFC 4791) namespaced errors
//   "CARDDAV:..."  → CardDAV (RFC 6352) namespaced errors
//
// router.ts splits on the first ":" to determine the XML namespace, so all
// precondition strings MUST follow the "NS:local-name" pattern.
// ---------------------------------------------------------------------------

/** RFC 4918 — WebDAV */
export type WebDavPrecondition =
	| "DAV:lock-token-matches-request-uri" // 409
	| "DAV:lock-token-submitted" // 423 — includes lock URLs in body
	| "DAV:no-conflicting-lock" // 423 — includes root lock URLs in body
	| "DAV:no-external-entities" // 403
	| "DAV:preserved-live-properties" // 409
	| "DAV:propfind-finite-depth" // 403
	| "DAV:cannot-modify-protected-property" // 403
	| "DAV:number-of-matches-within-limits" // postcondition (no specific status)
	| "DAV:valid-sync-token"; // 400 / 409

/** RFC 3744 — WebDAV Access Control */
export type AclPrecondition =
	| "DAV:need-privileges" // 403 — includes resource/privilege detail in body
	| "DAV:no-abstract"
	| "DAV:not-supported-privilege"
	| "DAV:missing-required-principal"
	| "DAV:recognized-principal"
	| "DAV:allowed-principal"
	| "DAV:grant-only"
	| "DAV:no-invert";

/** RFC 4791 — CalDAV */
export type CalDavPrecondition =
	| "CALDAV:supported-calendar-data" // 415 / 403
	| "CALDAV:valid-calendar-data" // 400 / 403
	| "CALDAV:valid-calendar-object-resource" // 400 / 403
	| "CALDAV:supported-calendar-component" // 403
	| "CALDAV:no-uid-conflict" // 409
	| "CALDAV:calendar-collection-location-ok" // 403
	| "CALDAV:max-resource-size" // 413
	| "CALDAV:min-date-time" // 403
	| "CALDAV:max-date-time" // 403
	| "CALDAV:valid-filter" // 400
	| "CALDAV:supported-filter" // 403
	| "CALDAV:supported-collation" // 403
	| "CALDAV:valid-calendar-timezone"; // 400

/** RFC 6352 — CardDAV */
export type CardDavPrecondition =
	| "CARDDAV:supported-address-data" // 415 / 403
	| "CARDDAV:valid-address-data" // 400 / 403
	| "CARDDAV:valid-filter" // 400
	| "CARDDAV:no-uid-conflict" // 409
	| "CARDDAV:max-resource-size"; // 413

export type DavPrecondition =
	| WebDavPrecondition
	| AclPrecondition
	| CalDavPrecondition
	| CardDavPrecondition;

// Compile-time check: every DavPrecondition must follow "NS:local-name" format.
// If a precondition string is added that doesn't match, this type assignment fails.
type _AssertPreconditionHasNamespace = DavPrecondition extends
	| `DAV:${string}`
	| `CALDAV:${string}`
	| `CARDDAV:${string}`
	? true
	: never;
const _assertPreconditionHasNamespace: _AssertPreconditionHasNamespace = true;

// ---------------------------------------------------------------------------
// DAV protocol error — carries HTTP status + optional precondition element
// ---------------------------------------------------------------------------

export class DavError extends Data.TaggedError("DavError")<{
	readonly status: HttpStatus;
	readonly precondition?: DavPrecondition;
	readonly message?: string;
}> {}

export const davError = (
	status: HttpStatus,
	precondition?: DavPrecondition,
	message?: string,
): DavError => new DavError({ status, precondition, message });

// Common shortcuts
export const notFound = (message?: string): DavError =>
	davError(HTTP_NOT_FOUND, undefined, message);

export const methodNotAllowed = (message?: string): DavError =>
	davError(HTTP_METHOD_NOT_ALLOWED, undefined, message);

export const forbidden = (
	precondition?: DavPrecondition,
	message?: string,
): DavError => davError(HTTP_FORBIDDEN, precondition, message);

export const conflict = (
	precondition?: DavPrecondition,
	message?: string,
): DavError => davError(HTTP_CONFLICT, precondition, message);

export const needPrivileges = (message?: string): DavError =>
	davError(HTTP_FORBIDDEN, "DAV:need-privileges", message);

export const validCalendarData = (message?: string): DavError =>
	davError(HTTP_BAD_REQUEST, "CALDAV:valid-calendar-data", message);

export const validAddressData = (message?: string): DavError =>
	davError(HTTP_BAD_REQUEST, "CARDDAV:valid-address-data", message);

export const preconditionFailed = (
	precondition?: DavPrecondition,
	message?: string,
): DavError => davError(HTTP_PRECONDITION_FAILED, precondition, message);

export const unsupportedMediaType = (
	precondition?: DavPrecondition,
	message?: string,
): DavError => davError(HTTP_UNSUPPORTED_MEDIA_TYPE, precondition, message);

// ---------------------------------------------------------------------------
// Effect helpers for common Option → DavError patterns
// ---------------------------------------------------------------------------

/**
 * Unwrap an Option, failing with a 404 DavError if it is None.
 * Intended for use with `Effect.flatMap`:
 *   repo.findById(id).pipe(Effect.flatMap(someOrNotFound(`X not found: ${id}`)))
 */
export const someOrNotFound =
	(message?: string) =>
	<A>(opt: Option.Option<A>): Effect.Effect<A, DavError, never> =>
		Option.match(opt, {
			onNone: () => Effect.fail(notFound(message)),
			onSome: Effect.succeed,
		});

/**
 * Fail with a 409 conflict DavError if the Option is Some (i.e. resource already exists).
 * Intended for use with `Effect.flatMap` before an insert:
 *   repo.findBySlug(...).pipe(Effect.flatMap(noneOrConflict(`X already exists`)), Effect.flatMap(() => repo.insert(...)))
 */
export const noneOrConflict =
	(precondition?: DavPrecondition, message?: string) =>
	<A>(opt: Option.Option<A>): Effect.Effect<void, DavError, never> =>
		Option.match(opt, {
			onSome: () => Effect.fail(conflict(precondition, message)),
			onNone: () => Effect.void,
		});

// ---------------------------------------------------------------------------
// Union of all error types
// ---------------------------------------------------------------------------

export type AppError =
	| DatabaseError
	| ConflictError
	| AuthError
	| XmlParseError
	| InternalError
	| ConfigError
	| DavError;
