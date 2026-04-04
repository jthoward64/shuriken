import { Option } from "effect";
import type { IrDocument } from "../ir.ts";

/**
 * Extract the UID from the first child component of a VCALENDAR.
 *
 * Per RFC 4791 §4.1, all components in a single calendar object resource must
 * share the same UID (a recurrence set and its overrides all carry one UID;
 * unrelated events must be stored in separate resources). Taking the first
 * child component's UID is therefore unambiguous for a well-formed resource.
 *
 * Returns None when:
 *   - the document has no child components (e.g. empty VCALENDAR)
 *   - the first child has no UID property
 *   - the UID value type is not TEXT (unexpected — UID is always TEXT in iCal)
 */
export const extractUid = (doc: IrDocument): Option.Option<string> => {
	if (doc.kind !== "icalendar") { return Option.none(); }
	const firstChild = doc.root.components.at(0);
	if (firstChild === undefined) { return Option.none(); }
	const prop = firstChild.properties.find((p) => p.name === "UID");
	if (prop === undefined || prop.value.type !== "TEXT") { return Option.none(); }
	return Option.some(prop.value.value);
};
