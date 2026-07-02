import type { IrProperty } from "#src/data/ir.ts";
import { baseName } from "#src/data/vcard/prop.ts";

// ---------------------------------------------------------------------------
// Contact-cleanup field helpers. The generic, group- and TYPE-aware property
// helpers now live in `#src/data/vcard/prop.ts` (shared with card-edit); they
// are re-exported here so existing cleanup imports keep working.
// ---------------------------------------------------------------------------

export {
	baseName,
	getText,
	getTypeTokens,
	groupOf,
	isProp,
} from "#src/data/vcard/prop.ts";

/**
 * Index of the `occurrence`-th property whose base name is `base`, counting
 * every match (including empty-valued ones) so analyzer and apply-fix agree on
 * numbering. Returns -1 when not found.
 */
export const nthPropIndex = (
	props: ReadonlyArray<IrProperty>,
	base: string,
	occurrence: number,
): number => {
	let seen = -1;
	for (let i = 0; i < props.length; i++) {
		const p = props[i];
		if (p && baseName(p.name) === base) {
			seen++;
			if (seen === occurrence) {
				return i;
			}
		}
	}
	return -1;
};

/** Digits only, dropping formatting, spaces, and punctuation. */
export const digitsOf = (s: string): string => s.replace(/\D/g, "");
