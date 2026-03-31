import { FiberRef } from "effect";
import type { RequestId } from "#/domain/ids.ts";
import { RequestId as mkRequestId } from "#/domain/ids.ts";
import type { AuthResult } from "#/domain/types/dav.ts";

// ---------------------------------------------------------------------------
// Request-scoped context propagated via FiberRef
//
// Set once by the top-level router at the start of each request.
// Any deeply nested effect (service, repository, logger) can read it
// without needing it passed as a parameter.
// ---------------------------------------------------------------------------

export const RequestIdRef = FiberRef.unsafeMake<RequestId | undefined>(
  undefined,
);

export const getRequestId = FiberRef.get(RequestIdRef);
export const setRequestId = (id: RequestId) => FiberRef.set(RequestIdRef, id);

export const newRequestId = (): RequestId =>
  mkRequestId(crypto.randomUUID());

// ---------------------------------------------------------------------------
// HttpRequestContext — parsed, validated request data passed to handlers
// All raw Request data is accessed only in the router; handlers receive this.
// ---------------------------------------------------------------------------

export type HttpRequestContext = {
  readonly requestId: RequestId;
  readonly method: string;
  readonly url: URL;
  readonly headers: Headers;
  readonly auth: AuthResult;
  /** Remote client IP from server.requestIP(req), or null if unavailable. */
  readonly clientIp: string | null;
};
