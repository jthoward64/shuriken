// ---------------------------------------------------------------------------
// Apple's X-ABLabel convention (vCard 3.0).
//
// Apple labels a grouped property by pairing it with a sibling
// `itemN.X-ABLABEL` in the same group. Its BUILT-IN labels are wrapped in a
// localisation marker — `_$!<Spouse>!$_` — which clients render as the
// user's-language name for that relation; user-authored CUSTOM labels are
// stored verbatim.
//
// These are pure format primitives; which values count as junk, or which
// relations a UI offers, are policy decisions that live with their callers.
// ---------------------------------------------------------------------------

const APPLE_STD_LABEL = /^_\$!<(.+)>!\$_$/;

/** True when a label is one of Apple's wrapped built-in labels. */
export const isWrappedAppleLabel = (value: string): boolean =>
	APPLE_STD_LABEL.test(value.trim());

/** Wrap a plain label in Apple's built-in form: `Home` → `_$!<Home>!$_`. */
export const wrapAppleLabel = (label: string): string => `_$!<${label}>!$_`;

/** Strip Apple's built-in wrapper: `_$!<Home>!$_` → `Home`. Other values pass through. */
export const unwrapAppleLabel = (value: string): string =>
	APPLE_STD_LABEL.exec(value.trim())?.[1] ?? value.trim();
