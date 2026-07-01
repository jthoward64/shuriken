import { Data, Result } from "effect";
import type { IrComponent, IrParameter, IrProperty } from "#src/data/ir.ts";
import { getText, getTypeValue, nthPropIndex } from "./fields.ts";
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

// Replace, add, or drop (newType null/empty) the TYPE parameter.
const withType = (prop: IrProperty, newType: string | null): IrProperty => {
	const others: ReadonlyArray<IrParameter> = prop.parameters.filter(
		(p) => p.name !== "TYPE",
	);
	const parameters =
		newType && newType !== ""
			? [...others, { name: "TYPE", value: newType }]
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
const locate = (
	vcard: IrComponent,
	name: string,
	occurrence: number,
	expected: string,
): Result.Result<{ index: number; prop: IrProperty }, CleanupStaleError> => {
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

export const applyFix = (
	vcard: IrComponent,
	fix: CleanupFix,
): Result.Result<IrComponent, CleanupStaleError> => {
	switch (fix._tag) {
		case "SetPhone":
			return Result.map(
				locate(vcard, "TEL", fix.occurrence, fix.current),
				({ index, prop }) =>
					withProps(
						vcard,
						replaceAt(vcard.properties, index, withTextValue(prop, fix.next)),
					),
			);
		case "LowercaseEmail":
			return Result.map(
				locate(vcard, "EMAIL", fix.occurrence, fix.current),
				({ index, prop }) =>
					withProps(
						vcard,
						replaceAt(vcard.properties, index, withTextValue(prop, fix.next)),
					),
			);
		case "SetNameCase":
			return Result.map(
				locate(vcard, fix.field, 0, fix.current),
				({ index, prop }) =>
					withProps(
						vcard,
						replaceAt(vcard.properties, index, withTextValue(prop, fix.next)),
					),
			);
		case "RemoveDuplicate":
			return Result.map(
				locate(vcard, fix.propName, fix.occurrence, fix.value),
				({ index }) => withProps(vcard, removeAt(vcard.properties, index)),
			);
		case "SetLabel": {
			const index = nthPropIndex(
				vcard.properties,
				fix.propName,
				fix.occurrence,
			);
			const prop = vcard.properties[index];
			if (index < 0 || prop === undefined) {
				return stale(`${fix.propName} #${fix.occurrence} no longer exists`);
			}
			if (getTypeValue(prop) !== fix.current) {
				return stale(`${fix.propName} #${fix.occurrence} label changed`);
			}
			return Result.succeed(
				withProps(
					vcard,
					replaceAt(vcard.properties, index, withType(prop, fix.newType)),
				),
			);
		}
	}
};
