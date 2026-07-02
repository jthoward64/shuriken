import type { IrProperty } from "#src/data/ir.ts";

// ---------------------------------------------------------------------------
// Generic vCard IR property helpers, group- and multi-TYPE-aware.
//
// vCard (Apple/Google, RFC 6350 §3.3) uses two conventions naive name/TYPE
// reads miss:
//   * GROUP prefixes — `item1.EMAIL` is an EMAIL scoped to group `item1` (which
//     ties it to a sibling `item1.X-ABLABEL`). Match on the base name; expose
//     the group separately.
//   * Repeated TYPE params — `TYPE=HOME;TYPE=VOICE;TYPE=pref` rather than the
//     comma-joined `TYPE=HOME,VOICE`. `getTypeTokens` collects both forms.
// ---------------------------------------------------------------------------

/** The group prefix of a property name (`item1.EMAIL` → `item1`), or "". */
export const groupOf = (name: string): string => {
	const dot = name.lastIndexOf(".");
	return dot === -1 ? "" : name.slice(0, dot);
};

/** The property name without its group prefix (`item1.EMAIL` → `EMAIL`). */
export const baseName = (name: string): string => {
	const dot = name.lastIndexOf(".");
	return dot === -1 ? name : name.slice(dot + 1);
};

/** True when `prop`'s base name equals `base` (group-insensitive). */
export const isProp = (prop: IrProperty, base: string): boolean =>
	baseName(prop.name) === base;

/**
 * All `TYPE` tokens on a property, across repeated params and comma-joined
 * values, trimmed and non-empty. Order preserved; original case kept.
 */
export const getTypeTokens = (prop: IrProperty): ReadonlyArray<string> =>
	prop.parameters
		.filter((p) => p.name === "TYPE")
		.flatMap((p) => p.value.split(","))
		.map((t) => t.trim())
		.filter((t) => t !== "");

/** Text of a property when it is a TEXT/URI value; "" otherwise (or undefined). */
export const getText = (prop: IrProperty | undefined): string => {
	if (!prop) {
		return "";
	}
	return prop.value.type === "TEXT" || prop.value.type === "URI"
		? prop.value.value
		: "";
};
