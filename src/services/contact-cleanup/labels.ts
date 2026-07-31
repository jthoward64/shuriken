import { isWrappedAppleLabel } from "#src/data/vcard/ab-label.ts";

// ---------------------------------------------------------------------------
// Label cleanup policy.
//
// Two labelling schemes exist in the wild:
//   * TYPE parameter tokens (Android/Google/Thunderbird, RFC 6350): home, work,
//     cell, voice, fax, … plus PREF.
//   * Apple X-ABLabel (vCard 3.0): a sibling `itemN.X-ABLABEL` property in the
//     same group — the wrapping convention itself lives in data/vcard/ab-label.ts.
//
// "Junk only" cleanup keys off unambiguous signals: the `_$!<…>!$_` wrapper is
// always a legitimate standard label (never flagged), and only a tiny denylist
// of values that are never real labels (leaked param keywords, empties) is
// flagged. Genuine custom labels are left untouched.
// ---------------------------------------------------------------------------

// Values that are never a real label — leaked parameter keywords and blanks.
// Deliberately tiny to avoid touching intentional custom labels. Note: `pref`
// here means a param keyword leaked into an X-ABLABEL *value*; it is unrelated
// to the preference channel (numeric PREF / the `preferred` flag).
const JUNK_LABELS = new Set(["value", "pref"]);

/**
 * A label value that is clearly junk (never chosen by a user): a leaked param
 * keyword or an empty/whitespace value. Wrapped Apple labels are never junk.
 */
export const isJunkLabel = (value: string): boolean => {
	const t = value.trim();
	if (t === "") {
		return true;
	}
	if (isWrappedAppleLabel(t)) {
		return false;
	}
	return JUNK_LABELS.has(t.toLowerCase());
};

/** Standard labels offered when relabelling. */
export const STANDARD_LABEL_OPTIONS: ReadonlyArray<string> = [
	"Home",
	"Work",
	"Other",
	"Mobile",
	"Main",
];
