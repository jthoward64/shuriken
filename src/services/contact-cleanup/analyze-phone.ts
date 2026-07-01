import type { IrComponent } from "#src/data/ir.ts";
import { getText } from "./fields.ts";
import { looksMissingAreaCode, normalizePhone } from "./phone.ts";
import { type PartialSuggestion, setPhoneFix } from "./types.ts";

// ---------------------------------------------------------------------------
// Phone formatting. Two suggestion shapes:
//   * a valid number whose canonical E.164 form differs from what's stored →
//     one-click reformat.
//   * a too-short national number with no country code → "missing area code",
//     which needs the user to supply the area code (fix.next filled in server-
//     side from the posted area code before applying).
// ---------------------------------------------------------------------------

export const analyzePhones = (
	vcard: IrComponent,
	region: string,
): ReadonlyArray<PartialSuggestion> => {
	const out: Array<PartialSuggestion> = [];
	let occ = -1;
	for (const p of vcard.properties) {
		if (p.name !== "TEL") {
			continue;
		}
		occ++;
		const current = getText(p);
		if (current.trim() === "") {
			continue;
		}
		const canonical = normalizePhone(current, region);
		if (canonical !== null) {
			if (canonical !== current) {
				out.push({
					category: "phone",
					title: "Phone number format",
					description: "Reformat to the international (E.164) form.",
					current,
					proposed: canonical,
					fix: setPhoneFix(occ, current, canonical),
				});
			}
			continue;
		}
		if (looksMissingAreaCode(current, region)) {
			out.push({
				category: "phone",
				title: "Phone missing area code",
				description: "This number looks like it's missing an area code.",
				current,
				proposed: "",
				needsInput: "areaCode",
				region,
				fix: setPhoneFix(occ, current, ""),
			});
		}
	}
	return out;
};
