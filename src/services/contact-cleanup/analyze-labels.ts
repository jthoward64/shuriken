import type { IrComponent, IrProperty } from "#src/data/ir.ts";
import { baseName, getText, getTypeTokens, groupOf, isProp } from "./fields.ts";
import {
	isJunkLabel,
	isWrappedAppleLabel,
	STANDARD_LABEL_OPTIONS,
} from "./labels.ts";
import { type PartialSuggestion, setAbLabelFix, setLabelFix } from "./types.ts";

// ---------------------------------------------------------------------------
// Unhelpful labels, across both labelling schemes (see labels.ts):
//
//   TYPE tokens (Android/Google):
//     * TYPE=VALUE      — a leaked parameter keyword, never a real label.
//     * TYPE=other on the *only* email/phone — "other" implies alternatives
//       that don't exist.
//
//   Apple X-ABLabel (vCard 3.0):
//     * A sibling `itemN.X-ABLABEL` whose value is junk (VALUE, PREF, empty).
//       Wrapped built-ins (`_$!<Other>!$_`) and genuine custom labels
//       (`TikTok`) are left alone.
//
// All are corrected via a user-picked standard label, or by removing the label.
// ---------------------------------------------------------------------------

const TYPE_LABEL_OPTIONS: Record<
	"EMAIL" | "TEL",
	readonly [string, ...Array<string>]
> = {
	EMAIL: ["home", "work"],
	TEL: ["cell", "home", "work", "fax"],
};

const fieldNoun = (base: string): string =>
	base === "EMAIL"
		? "email"
		: base === "TEL"
			? "phone number"
			: base === "URL"
				? "link"
				: base.toLowerCase();

// TYPE-based junk on EMAIL / TEL.
const analyzeTypeLabels = (
	vcard: IrComponent,
	propName: "EMAIL" | "TEL",
): ReadonlyArray<PartialSuggestion> => {
	const nonEmpty = vcard.properties.filter(
		(p) => isProp(p, propName) && getText(p).trim() !== "",
	).length;
	const options = TYPE_LABEL_OPTIONS[propName];

	const out: Array<PartialSuggestion> = [];
	let occ = -1;
	for (const p of vcard.properties) {
		if (!isProp(p, propName)) {
			continue;
		}
		occ++;
		if (getText(p).trim() === "") {
			continue;
		}
		const tokens = getTypeTokens(p);
		// The offending token: a leaked "VALUE", or a lonely "other".
		const junk =
			tokens.find((t) => t.toUpperCase() === "VALUE") ??
			(nonEmpty === 1
				? tokens.find((t) => t.toLowerCase() === "other")
				: undefined);
		if (junk === undefined) {
			continue;
		}
		out.push({
			category: "label",
			title: "Unhelpful label",
			description: `The label "${junk}" doesn't describe this ${fieldNoun(propName)}.`,
			current: junk,
			proposed: options[0],
			needsInput: "label",
			labelOptions: options,
			fix: setLabelFix(propName, occ, junk, options[0]),
		});
	}
	return out;
};

// What a grouped X-ABLABEL labels, for a friendlier description.
const labelledField = (
	vcard: IrComponent,
	xLabel: IrProperty,
): string | undefined => {
	const group = groupOf(xLabel.name);
	if (group === "") {
		return undefined;
	}
	const sibling = vcard.properties.find(
		(p) => groupOf(p.name) === group && baseName(p.name) !== "X-ABLABEL",
	);
	return sibling ? fieldNoun(baseName(sibling.name)) : undefined;
};

// Apple X-ABLabel junk.
const analyzeAbLabels = (
	vcard: IrComponent,
): ReadonlyArray<PartialSuggestion> => {
	const out: Array<PartialSuggestion> = [];
	let occ = -1;
	for (const p of vcard.properties) {
		if (!isProp(p, "X-ABLABEL")) {
			continue;
		}
		occ++;
		const value = getText(p);
		// Wrapped built-ins and genuine custom labels are intentional; skip.
		if (isWrappedAppleLabel(value) || !isJunkLabel(value)) {
			continue;
		}
		const field = labelledField(vcard, p);
		out.push({
			category: "label",
			title: "Unhelpful label",
			description: `The label "${value}" doesn't describe this${
				field ? ` ${field}` : " contact field"
			}.`,
			current: value,
			proposed: "(remove)",
			needsInput: "label",
			labelOptions: STANDARD_LABEL_OPTIONS,
			fix: setAbLabelFix(occ, value, null),
		});
	}
	return out;
};

export const analyzeLabels = (
	vcard: IrComponent,
): ReadonlyArray<PartialSuggestion> => [
	...analyzeTypeLabels(vcard, "EMAIL"),
	...analyzeTypeLabels(vcard, "TEL"),
	...analyzeAbLabels(vcard),
];
