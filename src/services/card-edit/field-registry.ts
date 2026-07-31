import type { IrProperty } from "#src/data/ir.ts";
import { baseName } from "#src/data/vcard/prop.ts";
import { RELATION_SOURCE_PROPS } from "#src/data/vcard/related.ts";

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

/**
 * Apple photo-companion properties. Machine-maintained descriptions of the
 * PHOTO value rather than user data, so they are metadata: preserved verbatim
 * while the photo is untouched, and reconciled by `merge-vcard` when it changes.
 * Hand-editing them only desynchronises them from the image.
 */
export const PHOTO_META_BASES: ReadonlySet<string> = new Set([
	"X-IMAGEHASH",
	"X-IMAGETYPE",
	"X-SHARED-PHOTO-DISPLAY-PREF",
]);

/**
 * Photo metadata that describes the *bytes* of a specific image and is
 * therefore invalidated by a new photo. `X-IMAGEHASH` is a content hash;
 * Apple's `X-ABCROP-RECTANGLE` PHOTO parameter ends with that same hash and
 * pins crop coordinates to it, so a surviving crop would frame the wrong image.
 *
 * Neither is regenerated: Apple's hash input is undocumented, and a hash we
 * computed differently would misdescribe the image more damagingly than its
 * absence. Dropping both lets a client recompute them.
 */
export const PHOTO_CONTENT_META_BASES: ReadonlySet<string> = new Set([
	"X-IMAGEHASH",
]);

/** PHOTO parameter pinning a crop to a particular image hash. */
export const PHOTO_CROP_PARAM = "X-ABCROP-RECTANGLE";

/** Discriminates a real photo from a generated monogram/avatar. */
export const PHOTO_TYPE = "X-IMAGETYPE";

/** `X-IMAGETYPE` value for an actual image. */
export const PHOTO_TYPE_PHOTO = "PHOTO";

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
	"RELATED",
	// Pre-canonicalisation spellings of RELATED, still present on cards stored
	// before the upgrade path existed: Apple's grouped pair and the
	// single-property AGENT / X-SPOUSE / X-MANAGER / X-ASSISTANT forms.
	"X-ABRELATEDNAMES",
	...RELATION_SOURCE_PROPS,
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
 * not metadata, not photo metadata, not an X-ABLabel, and its value is a plain
 * string (TEXT/URI) so it survives the string round-trip the generic editor
 * performs.
 */
export const isOtherEditable = (p: IrProperty): boolean => {
	const base = baseName(p.name);
	if (
		FRIENDLY_BASES.has(base) ||
		METADATA_BASES.has(base) ||
		PHOTO_META_BASES.has(base) ||
		base === "X-ABLABEL"
	) {
		return false;
	}
	return p.value.type === "TEXT" || p.value.type === "URI";
};
