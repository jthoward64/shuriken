// ---------------------------------------------------------------------------
// Heuristic name-case correction. Only ever invoked on names that are entirely
// upper- or lower-case (a strong signal of machine/careless entry); mixed-case
// names are left untouched to avoid clobbering deliberate styling. The result
// is always presented as a suggestion — never auto-applied.
//
// Handles: apostrophes (O'Hare, D'Angelo), Mc/Mac prefixes, hyphenated names
// (Mary-Jane), lowercase nobiliary particles (van der Berg), and roman-numeral
// / Jr / Sr suffixes.
// ---------------------------------------------------------------------------

const PARTICLES = new Set([
	"van",
	"von",
	"der",
	"den",
	"de",
	"di",
	"da",
	"del",
	"della",
	"la",
	"le",
	"du",
	"dos",
	"das",
	"bin",
	"al",
	"y",
	"e",
]);

const ROMAN = /^(?:i{1,3}|iv|v|vi{1,3}|ix|x)$/;
const SUFFIXES = new Set(["jr", "sr"]);

// "mc"/"mac" prefix handling only kicks in past these stem lengths.
const MC_MIN_LEN = 2;
const MAC_MIN_LEN = 5;

const capitalize = (w: string): string =>
	w === "" ? "" : w.charAt(0).toUpperCase() + w.slice(1);

const caseAtom = (atom: string): string => {
	const lower = atom.toLowerCase();
	if (lower === "") {
		return "";
	}
	if (ROMAN.test(lower)) {
		return lower.toUpperCase();
	}
	if (SUFFIXES.has(lower)) {
		return capitalize(lower);
	}
	if (PARTICLES.has(lower)) {
		return lower;
	}
	if (lower.includes("'")) {
		return lower.split("'").map(capitalize).join("'");
	}
	if (lower.startsWith("mc") && lower.length > MC_MIN_LEN) {
		return `Mc${capitalize(lower.slice("mc".length))}`;
	}
	// Require a longer stem so common non-Mac names (Mack, Macey) aren't mangled.
	if (lower.startsWith("mac") && lower.length > MAC_MIN_LEN) {
		return `Mac${capitalize(lower.slice("mac".length))}`;
	}
	return capitalize(lower);
};

// A word may be hyphenated (Mary-Jane); case each hyphen-atom independently.
const caseWord = (word: string): string =>
	word.split("-").map(caseAtom).join("-");

const casePart = (part: string): string =>
	part.split(" ").map(caseWord).join(" ");

/** True when `s` has letters and none of them are lowercase. */
export const isAllUpper = (s: string): boolean =>
	s === s.toUpperCase() && s !== s.toLowerCase();

/** True when `s` has letters and none of them are uppercase. */
export const isAllLower = (s: string): boolean =>
	s === s.toLowerCase() && s !== s.toUpperCase();

/** True when a name value is a candidate for case correction. */
export const looksMiscased = (s: string): boolean =>
	isAllUpper(s) || isAllLower(s);

/** Smart title-case for a free-text display name (FN). */
export const smartNameCase = (input: string): string => casePart(input);

/**
 * Smart title-case for a structured N value (`Family;Given;Additional;Prefix;
 * Suffix`): each semicolon-delimited component is cased independently and the
 * structure is preserved.
 */
export const smartStructuredNameCase = (input: string): string =>
	input.split(";").map(casePart).join(";");
