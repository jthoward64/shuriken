import { FiberRef, Option } from "effect";
import type { RequestId } from "#src/domain/ids.ts";
import { RequestId as mkRequestId } from "#src/domain/ids.ts";
import type { AuthResult } from "#src/domain/types/dav.ts";

// ---------------------------------------------------------------------------
// Request-scoped context propagated via FiberRef
//
// Set once by the top-level router at the start of each request.
// Any deeply nested effect (service, repository, logger) can read it
// without needing it passed as a parameter.
// ---------------------------------------------------------------------------

export const RequestIdRef = FiberRef.unsafeMake<Option.Option<RequestId>>(
	Option.none(),
);

export const getRequestId = FiberRef.get(RequestIdRef);
export const setRequestId = (id: RequestId) =>
	FiberRef.set(RequestIdRef, Option.some(id));

export const newRequestId = (): RequestId => mkRequestId(crypto.randomUUID());

// ---------------------------------------------------------------------------
// HttpRequestContext — parsed, validated request data passed to handlers
// All raw Request data is accessed only in the router; handlers receive this.
// ---------------------------------------------------------------------------

export interface HttpRequestContext {
	readonly requestId: RequestId;
	readonly method: string;
	readonly url: URL;
	readonly headers: Headers;
	readonly auth: AuthResult;
	/** Remote client IP from server.requestIP(req), or None if unavailable. */
	readonly clientIp: Option.Option<string>;
	/**
	 * Parsed CalDAV-Timezones request header (RFC 7809 §7.1).
	 *   "T" — client wants VTIMEZONE components included in responses
	 *   "F" — client does not want VTIMEZONE components for standard IANA timezones
	 *   null — header absent; server uses default behavior (include all)
	 */
	readonly caldavTimezones: "T" | "F" | null;
}
