import { Context, type Effect, type Option, type Redacted } from "effect";
import type { Temporal } from "temporal-polyfill";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { UserId } from "#src/domain/ids.ts";
import type { AuthenticatedPrincipal } from "#src/domain/types/dav.ts";

// ---------------------------------------------------------------------------
// SessionService — issues and validates web-UI browser sessions.
//
// `create` mints an opaque token (returned once, to be set as a cookie) and
// stores only its hash. `validate` resolves a token to the authenticated
// principal, or None when the session is unknown/expired. `revoke` deletes the
// session (logout). The TTL comes from config (SESSION_TTL_DAYS).
// ---------------------------------------------------------------------------

export interface IssuedSession {
	/** The raw token to place in the cookie. Never stored server-side. */
	readonly token: Redacted.Redacted<string>;
	readonly expiresAt: Temporal.Instant;
}

export interface CreateSessionInput {
	readonly userId: UserId;
	readonly userAgent: Option.Option<string>;
	readonly ip: Option.Option<string>;
}

export interface SessionServiceShape {
	readonly create: (
		input: CreateSessionInput,
	) => Effect.Effect<IssuedSession, DatabaseError>;
	readonly validate: (
		token: Redacted.Redacted<string>,
	) => Effect.Effect<Option.Option<AuthenticatedPrincipal>, DatabaseError>;
	readonly revoke: (
		token: Redacted.Redacted<string>,
	) => Effect.Effect<void, DatabaseError>;
}

export class SessionService extends Context.Service<
	SessionService,
	SessionServiceShape
>()("SessionService") {}
