import type { IrComponent } from "#src/data/ir.ts";
import { getText } from "./fields.ts";
import {
	looksMiscased,
	smartNameCase,
	smartStructuredNameCase,
} from "./name-case.ts";
import { type PartialSuggestion, setNameCaseFix } from "./types.ts";

// ---------------------------------------------------------------------------
// Name case. FN is a free-text display name; N is the structured
// `Family;Given;Additional;Prefix;Suffix` form. Both are only flagged when the
// stored value is entirely upper- or lower-case (see name-case.ts).
// ---------------------------------------------------------------------------

const nameSuggestion = (
	field: "N" | "FN",
	current: string,
	next: string,
): PartialSuggestion => ({
	category: "name",
	title: field === "FN" ? "Display name casing" : "Name casing",
	description: "This name looks mis-capitalised.",
	current,
	proposed: next,
	fix: setNameCaseFix(field, current, next),
});

export const analyzeNames = (
	vcard: IrComponent,
): ReadonlyArray<PartialSuggestion> => {
	const out: Array<PartialSuggestion> = [];

	const fn = vcard.properties.find((p) => p.name === "FN");
	const fnValue = getText(fn);
	if (fnValue.trim() !== "" && looksMiscased(fnValue)) {
		const next = smartNameCase(fnValue);
		if (next !== fnValue) {
			out.push(nameSuggestion("FN", fnValue, next));
		}
	}

	const n = vcard.properties.find((p) => p.name === "N");
	const nValue = getText(n);
	if (nValue.replace(/;/g, "").trim() !== "" && looksMiscased(nValue)) {
		const next = smartStructuredNameCase(nValue);
		if (next !== nValue) {
			out.push(nameSuggestion("N", nValue, next));
		}
	}

	return out;
};
