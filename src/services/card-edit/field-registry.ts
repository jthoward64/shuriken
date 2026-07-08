import type { IrProperty } from "#src/data/ir.ts";
import { baseName } from "#src/data/vcard/prop.ts";

// ---------------------------------------------------------------------------
// Classification shared by parse-vcard (what to surface) and merge-vcard (what
// to rebuild vs. preserve). Three buckets, by property base name:
//   * FRIENDLY  — has a dedicated widget; rebuilt from ContactFormData.
//   * METADATA  — machine/provenance; preserved verbatim, never shown/edited.
//   * everything else — the "generic" editor, but only when its value is
//     TEXT/URI (exotic-typed tail props are preserved verbatim to avoid a lossy
//     string round-trip). X-ABLABEL is preserved verbatim (tied to its grouped
//     value's widget), never generic.
// ---------------------------------------------------------------------------

export const FRIENDLY_BASES: ReadonlySet<string> = new Set([
	"FN",
	"N",
	"KIND",
	"NICKNAME",
	"EMAIL",
	"TEL",
	"URL",
	"ADR",
	"SOCIALPROFILE",
	"IMPP",
	"BDAY",
	"ANNIVERSARY",
	"GENDER",
	"GRAMGENDER",
	"PRONOUNS",
	"ORG",
	"TITLE",
	"NOTE",
	"CATEGORIES",
	"PHOTO",
]);

export const METADATA_BASES: ReadonlySet<string> = new Set([
	"VERSION",
	"UID",
	"PRODID",
	"REV",
	"SOURCE",
	"XML",
	"CLIENTPIDMAP",
	"CREATED",
]);

/**
 * True when a property belongs in the generic ("other") editor: not friendly,
 * not metadata, not an X-ABLabel, and its value is a plain string (TEXT/URI) so
 * it survives the string round-trip the generic editor performs.
 */
export const isOtherEditable = (p: IrProperty): boolean => {
	const base = baseName(p.name);
	if (
		FRIENDLY_BASES.has(base) ||
		METADATA_BASES.has(base) ||
		base === "X-ABLABEL"
	) {
		return false;
	}
	return p.value.type === "TEXT" || p.value.type === "URI";
};
