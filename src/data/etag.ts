import { Effect } from "effect";

// ---------------------------------------------------------------------------
// ETag generation (RFC 7232 §2.3)
//
// Produces a strong ETag for a CalDAV/CardDAV resource from its canonical
// encoded content string. Uses the Web Crypto API (platform-agnostic).
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

// Number of hex characters to use from the SHA-256 digest (32 chars = 128 bits).
// This provides sufficient collision resistance for DAV resource fingerprinting.
const ETAG_HEX_LENGTH = 32;
// Radix for hexadecimal string conversion.
const HEX_RADIX = 16;
// Minimum number of characters needed to zero-pad a single byte's hex representation.
const HEX_PAD_WIDTH = 2;

/**
 * Produce a stable strong ETag for a CalDAV/CardDAV resource.
 * Input is the canonical encoded iCalendar or vCard string.
 * Returns a quoted strong ETag per RFC 7232 §2.3: `"<hex>"`.
 */
export const makeEtag = (content: string): Effect.Effect<string, never> =>
	Effect.promise(async () => {
		const buf = await crypto.subtle.digest("SHA-256", encoder.encode(content));
		const hex = Array.from(new Uint8Array(buf))
			.map((b) => b.toString(HEX_RADIX).padStart(HEX_PAD_WIDTH, "0"))
			.join("")
			.slice(0, ETAG_HEX_LENGTH);
		return `"${hex}"`;
	});
