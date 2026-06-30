// ---------------------------------------------------------------------------
// Opaque-token helpers for sessions.
//
// `generateSessionToken` mints a 256-bit URL-safe random token (the cookie
// value). `sha256Hex` derives the stored lookup key. Both use Web Crypto so the
// same code runs under Deno, Node, and Bun.
// ---------------------------------------------------------------------------

const SESSION_TOKEN_BYTES = 32;
const HEX_RADIX = 16;
const HEX_BYTE_WIDTH = 2;

const toBase64Url = (bytes: Uint8Array): string => {
	let binary = "";
	for (const b of bytes) {
		binary += String.fromCharCode(b);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
};

export const generateSessionToken = (): string => {
	const bytes = new Uint8Array(SESSION_TOKEN_BYTES);
	crypto.getRandomValues(bytes);
	return toBase64Url(bytes);
};

/** Hex-encoded SHA-256 of `value` (for the session token-hash lookup key). */
export const sha256Hex = async (value: string): Promise<string> => {
	const data = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest("SHA-256", data);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, "0"))
		.join("");
};
