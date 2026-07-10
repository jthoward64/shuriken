import { Brand } from "effect";

// ---------------------------------------------------------------------------
// Email — branded email address string
// ---------------------------------------------------------------------------

export type Email = string & Brand.Brand<"Email">;
export const Email = Brand.nominal<Email>();

/**
 * Boundary parser for account-identity emails: trims and lowercases before
 * branding, so "Alice@Example.com" and "alice@example.com" always resolve to
 * the same `Email` key. The `user_email_key` unique constraint and every
 * `findByEmail` lookup are case-sensitive on the raw column, so constructing
 * an `Email` any other way for account lookup/storage risks two rows (or a
 * mismatch between the row an account was created with and the one an OIDC
 * IdP or admin input later matches against).
 */
export const parseEmail = (raw: string): Email =>
	Email(raw.trim().toLowerCase());

// ---------------------------------------------------------------------------
// ETag — HTTP entity tag for DAV instances
// ---------------------------------------------------------------------------

export type ETag = string & Brand.Brand<"ETag">;
export const ETag = Brand.nominal<ETag>();
