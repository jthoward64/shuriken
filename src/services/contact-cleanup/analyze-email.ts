import type { IrComponent } from "#src/data/ir.ts";
import { getText } from "./fields.ts";
import { lowercaseEmailFix, type PartialSuggestion } from "./types.ts";

// ---------------------------------------------------------------------------
// Email casing. Email addresses are treated case-insensitively in practice, so
// we lowercase the whole address (both local-part and domain). The local-part
// is technically case-sensitive per RFC 5321, but real-world mailboxes never
// rely on that, and consistent lowercasing is what users expect from cleanup.
// ---------------------------------------------------------------------------

export const analyzeEmails = (
	vcard: IrComponent,
): ReadonlyArray<PartialSuggestion> => {
	const out: Array<PartialSuggestion> = [];
	let occ = -1;
	for (const p of vcard.properties) {
		if (p.name !== "EMAIL") {
			continue;
		}
		occ++;
		const current = getText(p);
		if (current.trim() === "") {
			continue;
		}
		const next = current.toLowerCase();
		if (next !== current) {
			out.push({
				category: "email",
				title: "Email casing",
				description: "This email address contains uppercase letters.",
				current,
				proposed: next,
				fix: lowercaseEmailFix(occ, current, next),
			});
		}
	}
	return out;
};
