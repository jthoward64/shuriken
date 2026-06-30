import { Data } from "effect";

// ---------------------------------------------------------------------------
// OidcError — any failure in the OIDC discovery / authorization-code flow.
//
// `reason` is a short, log-safe summary; `cause` carries the underlying
// openid-client error (never surfaced to the browser). The UI edge maps this
// to a generic 4xx/5xx so provider internals never leak.
// ---------------------------------------------------------------------------

export class OidcError extends Data.TaggedError("OidcError")<{
	readonly reason: string;
	readonly cause?: unknown;
}> {}
