import { Option } from "effect";
import type { IrDocument } from "../ir.ts";

/**
 * Extract the UID from the root VCARD component.
 *
 * vCard 4.0 specifies UID as URI type (e.g. `urn:uuid:...`).
 * vCard 3.0 clients may emit UID as TEXT — both are accepted.
 *
 * Returns None when:
 *   - the document is not a vcard
 *   - the root VCARD has no UID property
 *   - the UID value type is neither URI nor TEXT
 */
export const extractUid = (doc: IrDocument): Option.Option<string> => {
	if (doc.kind !== "vcard") {
		return Option.none();
	}
	const prop = doc.root.properties.find((p) => p.name === "UID");
	if (prop === undefined) {
		return Option.none();
	}
	const v = prop.value;
	if (v.type === "URI" || v.type === "TEXT") {
		return Option.some(v.value);
	}
	return Option.none();
};
