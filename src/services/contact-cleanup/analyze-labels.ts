import type { IrComponent } from "#src/data/ir.ts";
import { getText, getTypeValue } from "./fields.ts";
import { type PartialSuggestion, setLabelFix } from "./types.ts";

// ---------------------------------------------------------------------------
// Bad TYPE labels:
//   * TYPE=VALUE — always meaningless (a leaked parameter name, not a type).
//   * TYPE=other on the *only* email/phone — "other" implies alternatives that
//     don't exist; a real label reads better.
// Both are corrected via a user-picked label (or removing the label entirely).
// ---------------------------------------------------------------------------

const LABEL_OPTIONS: Record<
	"EMAIL" | "TEL",
	readonly [string, ...Array<string>]
> = {
	EMAIL: ["home", "work"],
	TEL: ["cell", "home", "work", "fax"],
};

const isBogus = (typeValue: string): boolean =>
	typeValue.toUpperCase() === "VALUE";

const isLonelyOther = (typeValue: string, total: number): boolean =>
	typeValue.toLowerCase() === "other" && total === 1;

const analyzeProp = (
	vcard: IrComponent,
	propName: "EMAIL" | "TEL",
): ReadonlyArray<PartialSuggestion> => {
	const props = vcard.properties.filter((p) => p.name === propName);
	const nonEmpty = props.filter((p) => getText(p).trim() !== "").length;
	const options = LABEL_OPTIONS[propName];

	const out: Array<PartialSuggestion> = [];
	let occ = -1;
	for (const p of vcard.properties) {
		if (p.name !== propName) {
			continue;
		}
		occ++;
		if (getText(p).trim() === "") {
			continue;
		}
		const typeValue = getTypeValue(p);
		const bad = isBogus(typeValue) || isLonelyOther(typeValue, nonEmpty);
		if (!bad) {
			continue;
		}
		out.push({
			category: "label",
			title: "Unhelpful label",
			description: `The label "${typeValue}" doesn't describe this ${
				propName === "EMAIL" ? "email" : "phone number"
			}.`,
			current: typeValue,
			proposed: options[0],
			needsInput: "label",
			labelOptions: options,
			fix: setLabelFix(propName, occ, typeValue, options[0]),
		});
	}
	return out;
};

export const analyzeLabels = (
	vcard: IrComponent,
): ReadonlyArray<PartialSuggestion> => [
	...analyzeProp(vcard, "EMAIL"),
	...analyzeProp(vcard, "TEL"),
];
