import { Context, type Effect, type Option, type Redacted } from "effect";
import type { Temporal } from "temporal-polyfill";
import type { DatabaseError } from "#src/domain/errors.ts";

// ---------------------------------------------------------------------------
// OidcLoginRepository — persistence for the short-lived `oidc_login` table.
//
// One row per in-flight authorization-code attempt, keyed by `state`. The
// callback `consume`s it: the row is deleted and returned in a single statement
// so a `state` can never be replayed. Rows past their TTL are swept separately.
// ---------------------------------------------------------------------------

export interface NewOidcLogin {
	readonly state: string;
	readonly pkceVerifier: Redacted.Redacted<string>;
	readonly nonce: Redacted.Redacted<string>;
	readonly returnTo: string;
	readonly expiresAt: Temporal.Instant;
}

export interface ConsumedOidcLogin {
	readonly pkceVerifier: Redacted.Redacted<string>;
	readonly nonce: Redacted.Redacted<string>;
	readonly returnTo: string;
	readonly expiresAt: Temporal.Instant;
}

export interface OidcLoginRepositoryShape {
	readonly create: (input: NewOidcLogin) => Effect.Effect<void, DatabaseError>;
	/**
	 * Atomically delete and return the pending login for `state`, or None when
	 * absent. The caller checks `expiresAt` against now (single-use either way).
	 */
	readonly consume: (
		state: string,
	) => Effect.Effect<Option.Option<ConsumedOidcLogin>, DatabaseError>;
	readonly deleteExpired: (
		now: Temporal.Instant,
	) => Effect.Effect<void, DatabaseError>;
}

export class OidcLoginRepository extends Context.Service<
	OidcLoginRepository,
	OidcLoginRepositoryShape
>()("OidcLoginRepository") {}
