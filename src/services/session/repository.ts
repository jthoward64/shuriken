import { Context, type Effect, type Option } from "effect";
import type { Temporal } from "temporal-polyfill";
import type { DatabaseError } from "#src/domain/errors.ts";
import type { PrincipalId, UserId, UuidString } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// SessionRepository — persistence for the `session` table.
//
// Sessions are looked up by the SHA-256 hash of the cookie token (the raw token
// never reaches the database). `findAuthByTokenHash` joins through to the
// principal so a single query both validates the session and yields everything
// the request context needs.
// ---------------------------------------------------------------------------

export interface NewSession {
	readonly userId: UserId;
	readonly tokenHash: string;
	readonly expiresAt: Temporal.Instant;
	readonly userAgent: string | null;
	readonly ip: string | null;
}

/** The identity behind an active session — shaped for AuthenticatedPrincipal. */
export interface SessionAuth {
	readonly sessionId: UuidString;
	readonly principalId: PrincipalId;
	readonly userId: UserId;
	readonly displayName: string | null;
}

export interface SessionRepositoryShape {
	readonly create: (input: NewSession) => Effect.Effect<void, DatabaseError>;
	/**
	 * Return the identity behind a non-expired session whose principal is not
	 * soft-deleted, or None. `now` is supplied by the caller for testability.
	 */
	readonly findAuthByTokenHash: (
		tokenHash: string,
		now: Temporal.Instant,
	) => Effect.Effect<Option.Option<SessionAuth>, DatabaseError>;
	readonly touch: (
		sessionId: UuidString,
		now: Temporal.Instant,
	) => Effect.Effect<void, DatabaseError>;
	readonly deleteByTokenHash: (
		tokenHash: string,
	) => Effect.Effect<void, DatabaseError>;
	/** Sweep expired sessions; returns nothing. */
	readonly deleteExpired: (
		now: Temporal.Instant,
	) => Effect.Effect<void, DatabaseError>;
}

export class SessionRepository extends Context.Service<
	SessionRepository,
	SessionRepositoryShape
>()("SessionRepository") {}
