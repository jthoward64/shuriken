// ---------------------------------------------------------------------------
// generateShareToken — 32-char URL-safe random string (24 bytes → base64url).
//
// Generated client-side at insert/regenerate time. Pure: deterministic only
// in its output shape, not its value. Uses Web Crypto so the same call works
// in Bun, Node, and Deno.
// ---------------------------------------------------------------------------

const SHARE_TOKEN_BYTES = 24;

export const generateShareToken = (): string => {
	const bytes = new Uint8Array(SHARE_TOKEN_BYTES);
	crypto.getRandomValues(bytes);
	let binary = "";
	for (const b of bytes) {
		binary += String.fromCharCode(b);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
};
