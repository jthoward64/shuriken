import type { IrComponent } from "#src/data/ir.ts";
import { digitsOf, getText, isProp } from "./fields.ts";
import { normalizePhone } from "./phone.ts";
import { type PartialSuggestion, removeDuplicateFix } from "./types.ts";

// ---------------------------------------------------------------------------
// Duplicate EMAIL / TEL values on a single contact. The first occurrence is
// kept; every later occurrence that normalises to the same value is offered for
// removal. Emails compare case-insensitively; phones compare by their canonical
// E.164 form when parseable (so "+1 415…" and "(415)…" match), else by digits.
// ---------------------------------------------------------------------------

const normalize = (
	propName: "EMAIL" | "TEL",
	raw: string,
	region: string,
): string =>
	propName === "EMAIL"
		? raw.trim().toLowerCase()
		: (normalizePhone(raw, region) ?? digitsOf(raw));

const analyzeProp = (
	vcard: IrComponent,
	propName: "EMAIL" | "TEL",
	region: string,
): ReadonlyArray<PartialSuggestion> => {
	const out: Array<PartialSuggestion> = [];
	const seen = new Set<string>();
	let occ = -1;
	for (const p of vcard.properties) {
		if (!isProp(p, propName)) {
			continue;
		}
		occ++;
		const raw = getText(p);
		const norm = normalize(propName, raw, region);
		if (norm === "") {
			continue;
		}
		if (seen.has(norm)) {
			out.push({
				category: "duplicate",
				title: propName === "EMAIL" ? "Duplicate email" : "Duplicate phone",
				description: `This ${
					propName === "EMAIL" ? "email" : "phone number"
				} is already listed on this contact.`,
				current: raw,
				proposed: "(remove)",
				fix: removeDuplicateFix(propName, occ, raw),
			});
		} else {
			seen.add(norm);
		}
	}
	return out;
};

export const analyzeDuplicates = (
	vcard: IrComponent,
	region: string,
): ReadonlyArray<PartialSuggestion> => [
	...analyzeProp(vcard, "EMAIL", region),
	...analyzeProp(vcard, "TEL", region),
];
