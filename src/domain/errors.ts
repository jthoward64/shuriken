// ---------------------------------------------------------------------------
// Infrastructure errors — typed, non-DAV
// ---------------------------------------------------------------------------

export interface DatabaseError {
	readonly _tag: "DatabaseError";
	readonly cause: unknown;
}

export interface AuthError {
	readonly _tag: "AuthError";
	readonly reason: string;
}

export interface XmlParseError {
	readonly _tag: "XmlParseError";
	readonly cause: unknown;
}

export interface InternalError {
	readonly _tag: "InternalError";
	readonly cause: unknown;
}

export interface ConfigError {
	readonly _tag: "ConfigError";
	readonly key: string;
}

// Constructors
export const databaseError = (cause: unknown): DatabaseError => ({
	_tag: "DatabaseError",
	cause,
});

export const authError = (reason: string): AuthError => ({
	_tag: "AuthError",
	reason,
});

export const xmlParseError = (cause: unknown): XmlParseError => ({
	_tag: "XmlParseError",
	cause,
});

export const internalError = (cause: unknown): InternalError => ({
	_tag: "InternalError",
	cause,
});

export const configError = (key: string): ConfigError => ({
	_tag: "ConfigError",
	key,
});

// ---------------------------------------------------------------------------
// DAV precondition / postcondition XML element names (per RFC)
// Format: "<NS-PREFIX>:<local-name>" where NS-PREFIX identifies the namespace.
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
	| "CARDDAV:no-uid-conflict" // 409
	| "CARDDAV:max-resource-size"; // 413

export type DavPrecondition =
	| WebDavPrecondition
	| AclPrecondition
	| CalDavPrecondition
	| CardDavPrecondition;

// ---------------------------------------------------------------------------
// DAV protocol error — carries HTTP status + optional precondition element
// ---------------------------------------------------------------------------

import {
	HTTP_BAD_REQUEST,
	HTTP_CONFLICT,
	HTTP_FORBIDDEN,
	HTTP_METHOD_NOT_ALLOWED,
	HTTP_NOT_FOUND,
	type HttpStatus,
} from "#src/http/status.ts";

export interface DavError {
	readonly _tag: "DavError";
	readonly status: HttpStatus;
	readonly precondition?: DavPrecondition;
	readonly message?: string;
}

export const davError = (
	status: HttpStatus,
	precondition?: DavPrecondition,
	message?: string,
): DavError => ({ _tag: "DavError", status, precondition, message });

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

// ---------------------------------------------------------------------------
// Effect helpers for common Option → DavError patterns
// ---------------------------------------------------------------------------

import { Effect, Option } from "effect";

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
	| AuthError
	| XmlParseError
	| InternalError
	| ConfigError
	| DavError;
