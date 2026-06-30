import { Context, type Effect, type Option, type Redacted } from "effect";
import type { OidcError } from "#src/services/oidc/error.ts";

// ---------------------------------------------------------------------------
// OidcService — wraps the OpenID Connect authorization-code (PKCE) flow.
//
// `beginLogin` produces the provider authorization URL plus the PKCE/nonce/state
// secrets the caller must persist (in `oidc_login`) to validate the callback.
// `completeLogin` exchanges the returned code, validating state, nonce, PKCE,
// and the ID-token signature, and returns the verified identity claims.
//
// The service performs only network/crypto work — no database access. Mapping
// claims to a local user (link-by-email, auto-provision) is the caller's job.
// ---------------------------------------------------------------------------

/** Secrets minted at login start; persisted by the caller, checked at callback. */
export interface OidcLoginStart {
	readonly authorizationUrl: string;
	readonly state: string;
	readonly nonce: Redacted.Redacted<string>;
	readonly pkceVerifier: Redacted.Redacted<string>;
}

/** Verified identity claims from a successful ID token. */
export interface OidcClaims {
	readonly issuer: string;
	readonly subject: string;
	readonly email: Option.Option<string>;
	readonly emailVerified: boolean;
	readonly name: Option.Option<string>;
}

export interface OidcCompleteInput {
	/** The full callback URL the browser hit (carries `code` and `state`). */
	readonly currentUrl: URL;
	readonly redirectUri: string;
	readonly state: string;
	readonly nonce: Redacted.Redacted<string>;
	readonly pkceVerifier: Redacted.Redacted<string>;
}

export interface OidcServiceShape {
	readonly beginLogin: (input: {
		readonly redirectUri: string;
	}) => Effect.Effect<OidcLoginStart, OidcError>;
	readonly completeLogin: (
		input: OidcCompleteInput,
	) => Effect.Effect<OidcClaims, OidcError>;
}

export class OidcService extends Context.Service<
	OidcService,
	OidcServiceShape
>()("OidcService") {}
