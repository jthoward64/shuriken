import type { IrComponent, IrProperty, IrValue } from "#src/data/ir.ts";
import { baseName, groupOf } from "#src/data/vcard/prop.ts";
import {
	addressJoined,
	adrProp,
	bdayValue,
	categoriesValue,
	emailProp,
	imppProp,
	isBlankAddress,
	labelParams,
	nValue,
	otherProp,
	prefParams,
	serviceParams,
	socialProp,
	telProp,
	typeParams,
	urlProp,
} from "./build-vcard.ts";
import { isOtherEditable } from "./field-registry.ts";
import type { ContactFormData, ContactServiceValue } from "./types.ts";

// ---------------------------------------------------------------------------
// mergeFormIntoVcard — non-destructive edit. Walks the existing property list
// in order, updates only the properties the form manages, and carries EVERYTHING
// ELSE verbatim: metadata (REV/PRODID/…), X-ABLabels, exotic-typed tail props,
// `itemN` groups, and all parameters.
//
//   * Managed multi families (EMAIL/TEL/URL/ADR/SOCIALPROFILE/IMPP) pair to form
//     rows by position and update in place — preserving group prefix, non-TYPE /
//     non-SERVICE-TYPE params, and sibling X-ABLABEL. Removed rows drop (+ orphan
//     label cleanup); added rows append bare.
//   * Managed singles (FN/N/KIND/NICKNAME/…) replace value keeping name; N keeps
//     components 2–4.
//   * "Other-editable" props (the generic editor's domain) are dropped here and
//     re-appended from `form.otherProps`, so add/edit/remove all take effect.
// ---------------------------------------------------------------------------

type Multi = "EMAIL" | "TEL" | "URL" | "ADR" | "SOCIALPROFILE" | "IMPP";
const MULTI: ReadonlyArray<Multi> = [
	"EMAIL",
	"TEL",
	"URL",
	"ADR",
	"SOCIALPROFILE",
	"IMPP",
];

type Single =
	| "FN"
	| "N"
	| "KIND"
	| "NICKNAME"
	| "BDAY"
	| "ANNIVERSARY"
	| "GENDER"
	| "GRAMGENDER"
	| "PRONOUNS"
	| "ORG"
	| "TITLE"
	| "NOTE"
	| "CATEGORIES"
	| "PHOTO";
const SINGLE: ReadonlyArray<Single> = [
	"FN",
	"N",
	"KIND",
	"NICKNAME",
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
];

const withValue = (prop: IrProperty, value: IrValue): IrProperty => ({
	...prop,
	value,
});

const withTypedValue = (
	prop: IrProperty,
	value: string,
	types: ReadonlyArray<string>,
	label: string | undefined,
	preferred: boolean,
): IrProperty => ({
	...prop,
	parameters: [
		...prop.parameters.filter(
			(p) => p.name !== "TYPE" && p.name !== "LABEL" && p.name !== "PREF",
		),
		...typeParams(types),
		...labelParams(label),
		...prefParams(preferred),
	],
	value: { type: "TEXT", value },
});

const withServiceValue = (
	prop: IrProperty,
	sv: ContactServiceValue,
): IrProperty => ({
	...prop,
	parameters: [
		...prop.parameters.filter((p) => p.name !== "SERVICE-TYPE"),
		...serviceParams(sv.service),
	],
	value: { type: prop.value.type === "TEXT" ? "TEXT" : "URI", value: sv.value },
});

const multiRows = (
	form: ContactFormData,
): Record<Multi, ReadonlyArray<unknown>> => ({
	EMAIL: form.emails.filter((e) => e.value !== ""),
	TEL: form.tels.filter((t) => t.value !== ""),
	URL: form.urls.filter((u) => u !== ""),
	ADR: form.addresses.filter((a) => !isBlankAddress(a)),
	SOCIALPROFILE: form.socialProfiles.filter((s) => s.value !== ""),
	IMPP: form.impps.filter((i) => i.value !== ""),
});

const updateMulti = (
	base: Multi,
	prop: IrProperty,
	row: unknown,
): IrProperty => {
	switch (base) {
		case "EMAIL":
		case "TEL": {
			const tv = row as ContactFormData["emails"][number];
			return withTypedValue(prop, tv.value, tv.types, tv.label, tv.preferred);
		}
		case "URL":
			return withValue(prop, {
				type: prop.value.type === "TEXT" ? "TEXT" : "URI",
				value: row as string,
			});
		case "ADR": {
			const addr = row as ContactFormData["addresses"][number];
			return withTypedValue(
				prop,
				addressJoined(addr),
				addr.types,
				addr.label,
				addr.preferred,
			);
		}
		case "SOCIALPROFILE":
		case "IMPP":
			return withServiceValue(prop, row as ContactServiceValue);
	}
};

const buildMulti = (base: Multi, row: unknown): IrProperty => {
	switch (base) {
		case "EMAIL":
			return emailProp(row as ContactFormData["emails"][number]);
		case "TEL":
			return telProp(row as ContactFormData["tels"][number]);
		case "URL":
			return urlProp(row as string);
		case "ADR":
			return adrProp(row as ContactFormData["addresses"][number]);
		case "SOCIALPROFILE":
			return socialProp(row as ContactServiceValue);
		case "IMPP":
			return imppProp(row as ContactServiceValue);
	}
};

const hasSingle = (base: Single, form: ContactFormData): boolean => {
	switch (base) {
		case "FN":
			return form.fn !== "";
		case "N":
			return (
				form.familyName !== "" ||
				form.givenName !== "" ||
				form.middleName !== "" ||
				form.prefix !== "" ||
				form.suffix !== ""
			);
		case "KIND":
			return form.kind !== "";
		case "NICKNAME":
			return form.nickname !== "";
		case "ORG":
			return form.org !== "";
		case "TITLE":
			return form.title !== "";
		case "NOTE":
			return form.note !== "";
		case "GENDER":
			return form.gender !== "";
		case "GRAMGENDER":
			return form.gramGender !== "";
		case "PRONOUNS":
			return form.pronouns !== "";
		case "BDAY":
			return bdayValue(form.bday) !== null;
		case "ANNIVERSARY":
			return bdayValue(form.anniversary) !== null;
		case "CATEGORIES":
			return categoriesValue(form.categoriesCsv).length > 0;
		case "PHOTO":
			return form.photo !== "";
	}
};

const text = (value: string): IrValue => ({ type: "TEXT", value });

const singleValue = (base: Single, form: ContactFormData): IrValue => {
	switch (base) {
		case "FN":
			return text(form.fn);
		case "KIND":
			return text(form.kind);
		case "NICKNAME":
			return text(form.nickname);
		case "ORG":
			return text(form.org);
		case "TITLE":
			return text(form.title);
		case "NOTE":
			return text(form.note);
		case "GENDER":
			return text(form.gender);
		case "GRAMGENDER":
			return text(form.gramGender);
		case "PRONOUNS":
			return text(form.pronouns);
		case "N":
			return text(
				nValue(
					form.familyName,
					form.givenName,
					form.middleName,
					form.prefix,
					form.suffix,
				),
			);
		case "BDAY":
			return bdayValue(form.bday) ?? text(form.bday);
		case "ANNIVERSARY":
			return bdayValue(form.anniversary) ?? text(form.anniversary);
		case "CATEGORIES":
			return {
				type: "TEXT_LIST",
				value: [...categoriesValue(form.categoriesCsv)],
			};
		case "PHOTO":
			return { type: "URI", value: form.photo };
	}
};

const updateSingle = (
	base: Single,
	prop: IrProperty,
	form: ContactFormData,
): IrProperty => withValue(prop, singleValue(base, form));

const buildSingle = (base: Single, form: ContactFormData): IrProperty => ({
	name: base,
	parameters: [],
	value: singleValue(base, form),
	isKnown: true,
});

export const mergeFormIntoVcard = (
	existing: IrComponent,
	form: ContactFormData,
	uid: string,
): IrComponent => {
	const rows = multiRows(form);
	const cursor: Record<Multi, number> = {
		EMAIL: 0,
		TEL: 0,
		URL: 0,
		ADR: 0,
		SOCIALPROFILE: 0,
		IMPP: 0,
	};
	const singleEmitted = new Set<Single>();
	const removedGroups = new Set<string>();
	const out: Array<IrProperty> = [];
	let sawVersion = false;
	let sawUid = false;

	for (const p of existing.properties) {
		const base = baseName(p.name);
		if (base === "VERSION") {
			out.push(p);
			sawVersion = true;
			continue;
		}
		if (base === "UID") {
			out.push(p);
			sawUid = true;
			continue;
		}
		if ((MULTI as ReadonlyArray<string>).includes(base)) {
			const m = base as Multi;
			const list = rows[m];
			const i = cursor[m];
			cursor[m] = i + 1;
			if (i < list.length) {
				out.push(updateMulti(m, p, list[i]));
			} else {
				const g = groupOf(p.name);
				if (g !== "") {
					removedGroups.add(g);
				}
			}
			continue;
		}
		if ((SINGLE as ReadonlyArray<string>).includes(base)) {
			const s = base as Single;
			singleEmitted.add(s);
			if (hasSingle(s, form)) {
				out.push(updateSingle(s, p, form));
			}
			continue;
		}
		// Generic editor owns these — drop; the form's otherProps rows replace them.
		if (isOtherEditable(p)) {
			continue;
		}
		// Metadata / X-ABLABEL / exotic-typed tail → verbatim.
		out.push(p);
	}

	for (const m of MULTI) {
		for (let i = cursor[m]; i < rows[m].length; i++) {
			out.push(buildMulti(m, rows[m][i]));
		}
	}
	for (const s of SINGLE) {
		if (!singleEmitted.has(s) && hasSingle(s, form)) {
			out.push(buildSingle(s, form));
		}
	}
	for (const o of form.otherProps) {
		if (o.name.trim() !== "") {
			out.push(otherProp(o));
		}
	}

	if (!sawUid) {
		out.unshift({
			name: "UID",
			parameters: [],
			value: { type: "URI", value: uid },
			isKnown: true,
		});
	}
	if (!sawVersion) {
		out.unshift({
			name: "VERSION",
			parameters: [],
			value: { type: "TEXT", value: "4.0" },
			isKnown: true,
		});
	}

	const pruned = out.filter((p) => {
		if (baseName(p.name) !== "X-ABLABEL") {
			return true;
		}
		const g = groupOf(p.name);
		if (g === "" || !removedGroups.has(g)) {
			return true;
		}
		return out.some(
			(q) =>
				q !== p && groupOf(q.name) === g && baseName(q.name) !== "X-ABLABEL",
		);
	});

	return { name: "VCARD", properties: pruned, components: existing.components };
};
