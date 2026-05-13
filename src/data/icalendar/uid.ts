import { Option } from "effect";
import type { IrDocument } from "../ir.ts";

/**
 * Extract the UID from the first scheduling child component of a VCALENDAR.
 *
 * Per RFC 4791 §4.1, all scheduling components (VEVENT/VTODO/VJOURNAL/VFREEBUSY)
 * in a single calendar object resource must share the same UID (a recurrence
 * set and its overrides all carry one UID; unrelated events must be stored in
 * separate resources). VTIMEZONE components do not carry UIDs, so we skip them
 * when locating the resource's identifying child.
 *
 * Returns None when:
 *   - the document has no scheduling components (e.g. only VTIMEZONE)
 *   - the first scheduling child has no UID property
 *   - the UID value type is not TEXT (unexpected — UID is always TEXT in iCal)
 */
const SCHEDULING_COMPONENTS: ReadonlySet<string> = new Set([
	"VEVENT",
	"VTODO",
	"VJOURNAL",
	"VFREEBUSY",
]);

export const extractUid = (doc: IrDocument): Option.Option<string> => {
	if (doc.kind !== "icalendar") {
		return Option.none();
	}
	const schedChild = doc.root.components.find((c) =>
		SCHEDULING_COMPONENTS.has(c.name),
	);
	if (schedChild === undefined) {
		return Option.none();
	}
	const prop = schedChild.properties.find((p) => p.name === "UID");
	if (prop === undefined || prop.value.type !== "TEXT") {
		return Option.none();
	}
	return Option.some(prop.value.value);
};
