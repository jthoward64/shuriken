// Picks a readable text colour (`#000000` or `#ffffff`) for a `#RRGGBB`
// background colour, via WCAG relative luminance. Calendar colours are
// user-chosen and arbitrary, so FullCalendar's event pills need a computed
// foreground rather than the app's fixed brand text colour (which is
// unreadable against dark calendar colours).

const HEX_BYTE_MASK = 0xff;
const BYTE_MAX = 255;
const SRGB_LINEAR_THRESHOLD = 0.03928;
const SRGB_LINEAR_DIVISOR = 12.92;
const SRGB_GAMMA_OFFSET = 0.055;
const SRGB_GAMMA_DIVISOR = 1.055;
const SRGB_GAMMA_EXPONENT = 2.4;
const RED_LUMINANCE_WEIGHT = 0.2126;
const GREEN_LUMINANCE_WEIGHT = 0.7152;
const BLUE_LUMINANCE_WEIGHT = 0.0722;
const RED_SHIFT = 16;
const GREEN_SHIFT = 8;
const BLUE_SHIFT = 0;
// W3C-recommended midpoint between black-on-colour and white-on-colour legibility.
const LUMINANCE_THRESHOLD = 0.179;

const linearizeChannel = (value: number, shift: number): number => {
	const c = ((value >> shift) & HEX_BYTE_MASK) / BYTE_MAX;
	return c <= SRGB_LINEAR_THRESHOLD
		? c / SRGB_LINEAR_DIVISOR
		: ((c + SRGB_GAMMA_OFFSET) / SRGB_GAMMA_DIVISOR) ** SRGB_GAMMA_EXPONENT;
};

export function contrastTextColor(hexColor: string): "#000000" | "#ffffff" {
	const match = /^#?([0-9a-fA-F]{6})$/.exec(hexColor.trim());
	const hex = match?.[1];
	if (hex === undefined) {
		return "#000000";
	}
	const value = Number.parseInt(hex, 16);
	const luminance =
		RED_LUMINANCE_WEIGHT * linearizeChannel(value, RED_SHIFT) +
		GREEN_LUMINANCE_WEIGHT * linearizeChannel(value, GREEN_SHIFT) +
		BLUE_LUMINANCE_WEIGHT * linearizeChannel(value, BLUE_SHIFT);
	return luminance > LUMINANCE_THRESHOLD ? "#000000" : "#ffffff";
}
