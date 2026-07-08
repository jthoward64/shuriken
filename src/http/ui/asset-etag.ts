import { Effect } from "effect";
import { InternalError } from "#src/domain/errors.ts";

// ---------------------------------------------------------------------------
// Strong ETag for startup-compiled assets (CSS bundle, client JS bundles).
//
// A short hex prefix of a SHA-256 over the asset bytes — enough to cache-bust
// across deploys (a new process recompiles) while keeping the header tiny. Uses
// web-standard `crypto.subtle`, so it stays runtime-portable per the
// platform-isolation rules.
// ---------------------------------------------------------------------------

const ETAG_BYTES = 8; // 64-bit prefix of the digest — ample for cache-busting
const HEX_RADIX = 16;
const HEX_WIDTH = 2;

export const strongEtag = (
	content: string | Uint8Array,
): Effect.Effect<string, InternalError> =>
	Effect.tryPromise({
		try: async () => {
			const bytes =
				typeof content === "string"
					? new TextEncoder().encode(content)
					: new Uint8Array(content);
			const digest = await crypto.subtle.digest("SHA-256", bytes);
			const hex = Array.from(new Uint8Array(digest).slice(0, ETAG_BYTES))
				.map((b) => b.toString(HEX_RADIX).padStart(HEX_WIDTH, "0"))
				.join("");
			return `"${hex}"`;
		},
		catch: (cause) => new InternalError({ cause }),
	});
