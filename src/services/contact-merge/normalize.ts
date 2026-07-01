// ---------------------------------------------------------------------------
// Value normalization for duplicate detection and merge de-duplication.
//
// These are the canonical forms two contacts are compared by. They are
// intentionally lossy — the goal is to collapse real-world formatting
// variations ("+1 (555) 123-4567" vs "5551234567") onto a single key, not to
// validate the input. An empty string means "no usable value" and callers
// skip it (never build a match key from "").
// ---------------------------------------------------------------------------

/** Case-insensitive, whitespace-trimmed email. */
export const normalizeEmail = (raw: string): string => raw.trim().toLowerCase();

/**
 * Digits-only phone. Spaces, dashes, parentheses, the leading "+" and every
 * other separator are dropped so differently-formatted copies of the same
 * number collapse together. Returns "" if no digits remain. Note that this is
 * deliberately not country-code aware: "5551234" and "15551234" stay distinct.
 */
export const normalizePhone = (raw: string): string => raw.replace(/\D/g, "");

/** NFC-normalized, case-folded, whitespace-collapsed display name. */
export const normalizeName = (raw: string): string =>
	raw.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
