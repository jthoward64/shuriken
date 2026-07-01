import type { IrComponent } from "#src/data/ir.ts";
import type { InstanceId } from "#src/domain/ids.ts";
import { analyzeDuplicates } from "./analyze-duplicates.ts";
import { analyzeEmails } from "./analyze-email.ts";
import { analyzeLabels } from "./analyze-labels.ts";
import { analyzeNames } from "./analyze-name.ts";
import { analyzePhones } from "./analyze-phone.ts";
import { getText } from "./fields.ts";
import type { CleanupSuggestion } from "./types.ts";

// ---------------------------------------------------------------------------
// analyzeCard — runs every analyzer over one vCard and stamps each suggestion
// with the card's identity. Pure; the service supplies the instanceId/region.
// ---------------------------------------------------------------------------

export const analyzeCard = (
	vcard: IrComponent,
	instanceId: InstanceId,
	region: string,
): ReadonlyArray<CleanupSuggestion> => {
	const contactFn =
		getText(vcard.properties.find((p) => p.name === "FN")) || "(no name)";

	const partials = [
		...analyzeNames(vcard),
		...analyzeEmails(vcard),
		...analyzePhones(vcard, region),
		...analyzeDuplicates(vcard, region),
		...analyzeLabels(vcard),
	];

	return partials.map((partial, i) => ({
		...partial,
		id: `${instanceId}-${i}`,
		instanceId,
		contactFn,
	}));
};
