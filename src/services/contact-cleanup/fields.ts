import type { IrProperty } from "#src/data/ir.ts";

// ---------------------------------------------------------------------------
// Small read helpers shared by the analyzers and apply-fix. vCard TEL/EMAIL/FN
// values are TEXT; TEL and PHOTO may also be URI — both carry a string `value`.
// ---------------------------------------------------------------------------

/** Text of a property when it is a TEXT/URI value; "" otherwise (or undefined). */
export const getText = (prop: IrProperty | undefined): string => {
	if (!prop) {
		return "";
	}
	return prop.value.type === "TEXT" || prop.value.type === "URI"
		? prop.value.value
		: "";
};

/** The comma-joined `TYPE` parameter value, or "" when absent. */
export const getTypeValue = (prop: IrProperty): string =>
	prop.parameters.find((p) => p.name === "TYPE")?.value ?? "";

/**
 * Index of the `occurrence`-th property named `name` within `props`, counting
 * every property of that name (including empty-valued ones) so analyzer and
 * apply-fix agree on numbering. Returns -1 when not found.
 */
export const nthPropIndex = (
	props: ReadonlyArray<IrProperty>,
	name: string,
	occurrence: number,
): number => {
	let seen = -1;
	for (let i = 0; i < props.length; i++) {
		if (props[i]?.name === name) {
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
