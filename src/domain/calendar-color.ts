import { type ClarkName, cn, type IrDeadProperties } from "#src/data/ir.ts";

// ---------------------------------------------------------------------------
// Calendar colour — Apple's `{http://apple.com/ns/ical/}calendar-color` dead
// property (RFC 4918 §4.1 dead prop). This is the single source of truth for a
// calendar's colour: DAV clients set it via PROPPATCH/MKCALENDAR, PROPFIND
// reflects it, and the web UI reads/writes it the same way — no separate
// column, so the UI stays consistent with real CalDAV clients.
//
// Apple stores colours as `#RRGGBBAA` (full-alpha convention). The web UI's
// `<input type="color">` only speaks `#RRGGBB`, so we normalise on the way in
// and out (see `toCssHex` / `fromCssHex`).
// ---------------------------------------------------------------------------

export const APPLE_ICAL_NS = "http://apple.com/ns/ical/";
export const CALENDAR_COLOR: ClarkName = cn(APPLE_ICAL_NS, "calendar-color");

// Default-colour palette (12 entries). When a calendar has no client-supplied
// calendar-color, we emit a deterministic pick so client UIs render distinct
// tiles instead of "no colour" placeholders. Values are RGB with full alpha
// (#RRGGBBAA per Apple's convention).
export const DEFAULT_CALENDAR_COLORS: ReadonlyArray<string> = [
	"#F44336FF",
	"#FF9800FF",
	"#FFC107FF",
	"#4CAF50FF",
	"#009688FF",
	"#03A9F4FF",
	"#3F51B5FF",
	"#9C27B0FF",
	"#E91E63FF",
	"#795548FF",
	"#607D8BFF",
	"#FF5722FF",
];

/**
 * Pick a deterministic default colour for a calendar collection. Hashes the
 * collection UUID's hex digits into the palette index so the same calendar
 * always renders with the same colour, but different calendars get spread
 * across the palette.
 */
export const defaultCalendarColor = (id: string): string => {
	let sum = 0;
	const hexRadix = 16;
	for (const ch of id.replaceAll("-", "")) {
		const n = Number.parseInt(ch, hexRadix);
		if (Number.isFinite(n)) {
			sum += n;
		}
	}
	// biome-ignore lint/style/noNonNullAssertion: index is always in-range (mod length)
	return DEFAULT_CALENDAR_COLORS[sum % DEFAULT_CALENDAR_COLORS.length]!;
};

/**
 * Resolve a calendar's effective colour: the client-set `calendar-color` dead
 * property if present and valid, otherwise the deterministic default for its
 * id. Mirrors PROPFIND so the web UI and DAV clients agree.
 */
// `#RRGGBB` or `#RRGGBBAA`.
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
// Length of a `#RRGGBB` string — used to trim an Apple `#RRGGBBAA` value.
const CSS_HEX_LENGTH = 7;

export const resolveCalendarColor = (
	clientProperties: IrDeadProperties | null | undefined,
	id: string,
): string => {
	const raw = clientProperties?.[CALENDAR_COLOR];
	if (typeof raw === "string" && HEX_COLOR_RE.test(raw)) {
		return raw;
	}
	return defaultCalendarColor(id);
};

/** Normalise an Apple `#RRGGBBAA`/`#RRGGBB` colour to a CSS `#RRGGBB` value. */
export const toCssHex = (appleColor: string): string =>
	appleColor.slice(0, CSS_HEX_LENGTH);

/**
 * Convert a UI `<input type="color">` value (`#RRGGBB`) to Apple's storage form
 * (`#RRGGBBFF`). Returns undefined for an empty/invalid value so callers can
 * clear the property.
 */
export const fromCssHex = (value: string): string | undefined => {
	if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
		return undefined;
	}
	return `${value.toUpperCase()}FF`;
};
