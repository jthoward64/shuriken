import { Data, Match, Result } from "effect";
import type { IrComponent, IrProperty } from "#src/data/ir.ts";
import { wrapAppleLabel } from "#src/data/vcard/ab-label.ts";
import { getText, getTypeTokens, nthPropIndex } from "./fields.ts";
import type { CleanupFix } from "./types.ts";

// ---------------------------------------------------------------------------
// applyFix — pure, surgical mutation of a vCard IR. Works property-by-property
// so unrelated properties (NICKNAME, ROLE, IMPP, …) round-trip untouched —
// unlike a form re-serialisation which would drop anything the UI form omits.
//
// Every fix carries the value it saw at scan time; if the card has since
// changed (property gone, or value/label no longer matches) we return a
// CleanupStaleError so the edge can ask the user to rescan rather than clobber.
// ---------------------------------------------------------------------------

export class CleanupStaleError extends Data.TaggedError("CleanupStaleError")<{
	readonly reason: string;
}> {}

const stale = (reason: string): Result.Result<never, CleanupStaleError> =>
	Result.fail(new CleanupStaleError({ reason }));

// Set the string value while preserving whether the property was TEXT or URI.
const withTextValue = (prop: IrProperty, next: string): IrProperty => ({
	...prop,
	value:
		prop.value.type === "URI"
			? { type: "URI", value: next }
			: { type: "TEXT", value: next },
});

// Remove one TYPE token (case-insensitive) and optionally add another, then
// re-emit the surviving tokens as a single comma-joined TYPE param (dropping
// TYPE entirely if none remain). Non-TYPE params are preserved.
const rewriteTypeTokens = (
	prop: IrProperty,
	removeToken: string,
	addToken: string | null,
): IrProperty => {
	const kept = getTypeTokens(prop).filter(
		(t) => t.toLowerCase() !== removeToken.toLowerCase(),
	);
	if (
		addToken &&
		addToken !== "" &&
		!kept.some((t) => t.toLowerCase() === addToken.toLowerCase())
	) {
		kept.push(addToken);
	}
	const others = prop.parameters.filter((p) => p.name !== "TYPE");
	const parameters =
		kept.length > 0
			? [...others, { name: "TYPE", value: kept.join(",") }]
			: others;
	return { ...prop, parameters };
};

const replaceAt = (
	props: ReadonlyArray<IrProperty>,
	index: number,
	next: IrProperty,
): ReadonlyArray<IrProperty> => props.map((p, i) => (i === index ? next : p));

const removeAt = (
	props: ReadonlyArray<IrProperty>,
	index: number,
): ReadonlyArray<IrProperty> => props.filter((_, i) => i !== index);

const withProps = (
	vcard: IrComponent,
	properties: ReadonlyArray<IrProperty>,
): IrComponent => ({ ...vcard, properties });

// Locate a property by (name, occurrence) and confirm its text still matches.
/** A property found by name and occurrence, with its position in the card. */
interface Located {
	readonly index: number;
	readonly prop: IrProperty;
}

const locate = (
	vcard: IrComponent,
	name: string,
	occurrence: number,
	expected: string,
): Result.Result<Located, CleanupStaleError> => {
	const index = nthPropIndex(vcard.properties, name, occurrence);
	const prop = vcard.properties[index];
	if (index < 0 || prop === undefined) {
		return stale(`${name} #${occurrence} no longer exists`);
	}
	if (getText(prop) !== expected) {
		return stale(`${name} #${occurrence} changed since the scan`);
	}
	return Result.succeed({ index, prop });
};

/** Replaces the located property's text value, preserving TEXT vs URI. */
const setLocatedText = (
	vcard: IrComponent,
	located: Result.Result<Located, CleanupStaleError>,
	next: string,
): Result.Result<IrComponent, CleanupStaleError> =>
	Result.map(located, ({ index, prop }) =>
		withProps(
			vcard,
			replaceAt(vcard.properties, index, withTextValue(prop, next)),
		),
	);

/** Rewrites one TYPE token on the nth property, or reports the card as stale. */
const applySetLabel = (
	vcard: IrComponent,
	fix: Extract<CleanupFix, { readonly _tag: "SetLabel" }>,
): Result.Result<IrComponent, CleanupStaleError> => {
	const index = nthPropIndex(vcard.properties, fix.propName, fix.occurrence);
	const prop = vcard.properties[index];
	if (index < 0 || prop === undefined) {
		return stale(`${fix.propName} #${fix.occurrence} no longer exists`);
	}
	const hasToken = getTypeTokens(prop).some(
		(t) => t.toLowerCase() === fix.current.toLowerCase(),
	);
	if (!hasToken) {
		return stale(`${fix.propName} #${fix.occurrence} label changed`);
	}
	return Result.succeed(
		withProps(
			vcard,
			replaceAt(
				vcard.properties,
				index,
				rewriteTypeTokens(prop, fix.current, fix.newType),
			),
		),
	);
};

/** Rewrites or drops an X-ABLABEL, depending on whether a new label was given. */
const applySetAbLabel = (
	vcard: IrComponent,
	fix: Extract<CleanupFix, { readonly _tag: "SetAbLabel" }>,
): Result.Result<IrComponent, CleanupStaleError> =>
	Result.map(
		locate(vcard, "X-ABLABEL", fix.occurrence, fix.current),
		({ index, prop }) =>
			fix.newLabel === null
				? withProps(vcard, removeAt(vcard.properties, index))
				: withProps(
						vcard,
						replaceAt(
							vcard.properties,
							index,
							withTextValue(prop, wrapAppleLabel(fix.newLabel)),
						),
					),
	);

export const applyFix = (
	vcard: IrComponent,
	fix: CleanupFix,
): Result.Result<IrComponent, CleanupStaleError> =>
	Match.value(fix).pipe(
		Match.tag("SetPhone", (f) =>
			setLocatedText(
				vcard,
				locate(vcard, "TEL", f.occurrence, f.current),
				f.next,
			),
		),
		Match.tag("LowercaseEmail", (f) =>
			setLocatedText(
				vcard,
				locate(vcard, "EMAIL", f.occurrence, f.current),
				f.next,
			),
		),
		Match.tag("SetNameCase", (f) =>
			setLocatedText(vcard, locate(vcard, f.field, 0, f.current), f.next),
		),
		Match.tag("RemoveDuplicate", (f) =>
			Result.map(
				locate(vcard, f.propName, f.occurrence, f.value),
				({ index }) => withProps(vcard, removeAt(vcard.properties, index)),
			),
		),
		Match.tag("SetLabel", (f) => applySetLabel(vcard, f)),
		Match.tag("SetAbLabel", (f) => applySetAbLabel(vcard, f)),
		Match.exhaustive,
	);
