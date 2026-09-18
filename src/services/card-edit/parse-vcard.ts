import type { IrComponent, IrProperty } from "#src/data/ir.ts";
import { unwrapAppleLabel } from "#src/data/vcard/ab-label.ts";
import {
	baseName,
	getText,
	getTypeTokens,
	groupOf,
	hasPrefTypeToken,
	isPreferred,
	stripPrefToken,
} from "#src/data/vcard/prop.ts";
import {
	AB_LABEL_PROP,
	AB_RELATED_PROP,
	RELATED_PROP,
	RELATION_NAME_PARAM,
	RELATION_SOURCE_PROPS,
	relationForSourceProp,
	relationOf,
} from "#src/data/vcard/related.ts";
import { serializeParams } from "./build-vcard.ts";
import { isOtherEditable } from "./field-registry.ts";
import { relationTargetFromValue } from "./relation-value.ts";
import type {
	ContactAddress,
	ContactFormData,
	ContactOtherProp,
	ContactRelation,
	ContactServiceValue,
	ContactTypedValue,
} from "./types.ts";
import { emptyContactForm } from "./types.ts";

// SOCIALPROFILE/IMPP service comes from SERVICE-TYPE; fall back to a TYPE token
// (Apple's legacy X-SOCIALPROFILE uses TYPE).
const serviceOf = (p: IrProperty): string => {
	const st = p.parameters.find((x) => x.name === "SERVICE-TYPE");
	if (st && st.value !== "") {
		return st.value;
	}
	return getTypeTokens(p)[0] ?? "";
};

// The LABEL parameter, empty when the row carries none.
const labelOf = (p: IrProperty): string =>
	p.parameters.find((x) => x.name === "LABEL")?.value ?? "";

// Canonical preference read: numeric PREF is authoritative, but honor a legacy
// `TYPE=pref` token for any card not yet upgraded on ingest.
const isPreferredRow = (p: IrProperty): boolean =>
	isPreferred(p) || hasPrefTypeToken(p);

// The `pref` token is stripped from `types` so preference lives on exactly one
// channel (`preferred`).
const typesOf = (p: IrProperty): ReadonlyArray<string> =>
	stripPrefToken(getTypeTokens(p));

// ---------------------------------------------------------------------------
// parseVcardToForm — pre-populates the edit form from a vCard. It surfaces only
// the fields the form knows; properties it doesn't surface are NOT lost, because
// the write-back (`mergeFormIntoVcard`) carries every unmanaged property/param
// through verbatim. Matching is group-aware (`item1.EMAIL` → EMAIL) and reads
// repeated TYPE params, so Apple/Google vCard 3.0 populates correctly.
// ---------------------------------------------------------------------------

const dateStr = (p: IrProperty): string => {
	if (p.value.type === "DATE") {
		return p.value.value.toString();
	}
	return p.value.type === "TEXT" || p.value.type === "URI" ? p.value.value : "";
};

/** Group → unwrapped label, from every `itemN.X-ABLABEL` in the card. */
const labelsByGroup = (vcard: IrComponent): ReadonlyMap<string, string> => {
	const out = new Map<string, string>();
	for (const p of vcard.properties) {
		const g = groupOf(p.name);
		if (g !== "" && baseName(p.name) === AB_LABEL_PROP) {
			out.set(g, unwrapAppleLabel(getText(p)));
		}
	}
	return out;
};

/**
 * A relation row from a canonical `RELATED`. The display name is the preserved
 * name parameter for a URI target, else the value itself.
 */
const relationFromProp = (p: IrProperty): ContactRelation => {
	const value = getText(p);
	const target = relationTargetFromValue(value);
	const preservedName =
		p.parameters.find((x) => x.name.toUpperCase() === RELATION_NAME_PARAM)
			?.value ?? "";
	return {
		target,
		name: target.kind === "text" ? value : preservedName,
		relation: relationOf(p),
		preferred: isPreferredRow(p),
	};
};

/** An EMAIL/TEL row: the value plus its TYPE, PREF and LABEL metadata. */
const typedValueFrom = (p: IrProperty): ContactTypedValue => {
	const label = labelOf(p);
	// `label` is included only when present, so label-free values stay
	// `{value, types}`.
	return {
		value: getText(p),
		types: typesOf(p),
		preferred: isPreferredRow(p),
		...(label === "" ? {} : { label }),
	};
};

/** An ADR row: the seven address components plus TYPE, PREF and LABEL. */
const addressFrom = (p: IrProperty): ContactAddress => {
	const parts = getText(p).split(";");
	const label = labelOf(p);
	return {
		poBox: parts[0] ?? "",
		extended: parts[1] ?? "",
		street: parts[2] ?? "",
		locality: parts[3] ?? "",
		region: parts[4] ?? "",
		postalCode: parts[5] ?? "",
		country: parts[6] ?? "",
		types: typesOf(p),
		preferred: isPreferredRow(p),
		...(label === "" ? {} : { label }),
	};
};

/** NICKNAME is a comma list in 4.0 and a single value in older cards. */
const nicknameFrom = (p: IrProperty): string =>
	p.value.type === "TEXT_LIST" ? [...p.value.value].join(", ") : getText(p);

/** CATEGORIES is a comma list in 4.0 and a single value in older cards. */
const categoriesFrom = (p: IrProperty): string =>
	p.value.type === "TEXT_LIST" ? [...p.value.value].join(", ") : getText(p);

/** A relation surfaced from a pre-canonicalisation form, given the group labels. */
const legacyRelationFrom = (
	p: IrProperty,
	relation: string,
): ContactRelation => ({
	target: { kind: "text" },
	name: getText(p),
	relation,
	preferred: isPreferredRow(p),
});

/**
 * Properties with no fixed case: the single-property relation forms
 * (AGENT / X-SPOUSE / …), which only survive on cards stored before
 * canonicalisation, then anything the generic editor owns.
 */
const parseTailProp = (
	p: IrProperty,
	relations: Array<ContactRelation>,
	otherProps: Array<ContactOtherProp>,
): void => {
	if (RELATION_SOURCE_PROPS.has(baseName(p.name))) {
		relations.push(
			legacyRelationFrom(p, relationForSourceProp(baseName(p.name))),
		);
		return;
	}
	if (isOtherEditable(p)) {
		otherProps.push({
			name: baseName(p.name),
			group: groupOf(p.name),
			value: getText(p),
			params: serializeParams(p.parameters),
		});
	}
};

export const parseVcardToForm = (vcard: IrComponent): ContactFormData => {
	const labels = labelsByGroup(vcard);
	const emails: Array<ContactTypedValue> = [];
	const tels: Array<ContactTypedValue> = [];
	const urls: Array<string> = [];
	const addresses: Array<ContactAddress> = [];
	const socialProfiles: Array<ContactServiceValue> = [];
	const impps: Array<ContactServiceValue> = [];
	const relations: Array<ContactRelation> = [];
	const otherProps: Array<ContactOtherProp> = [];
	let kind = "";
	let fn = "";
	let familyName = "";
	let givenName = "";
	let middleName = "";
	let prefix = "";
	let suffix = "";
	let nickname = "";
	let bday = "";
	let anniversary = "";
	let gender = "";
	let gramGender = "";
	let pronouns = "";
	let org = "";
	let title = "";
	let note = "";
	let categoriesCsv = "";
	let photo = "";

	for (const p of vcard.properties) {
		switch (baseName(p.name)) {
			case "KIND":
				kind = getText(p);
				break;
			case "FN":
				fn = getText(p);
				break;
			case "N": {
				const parts = getText(p).split(";");
				familyName = parts[0] ?? "";
				givenName = parts[1] ?? "";
				middleName = parts[2] ?? "";
				prefix = parts[3] ?? "";
				suffix = parts[4] ?? "";
				break;
			}
			case "NICKNAME":
				nickname = nicknameFrom(p);
				break;
			case "EMAIL":
				emails.push(typedValueFrom(p));
				break;
			case "TEL":
				tels.push(typedValueFrom(p));
				break;
			case "URL":
				urls.push(getText(p));
				break;
			case "ADR":
				addresses.push(addressFrom(p));
				break;
			case "SOCIALPROFILE":
				socialProfiles.push({ service: serviceOf(p), value: getText(p) });
				break;
			case "IMPP":
				impps.push({ service: serviceOf(p), value: getText(p) });
				break;
			case RELATED_PROP:
				relations.push(relationFromProp(p));
				break;
			// Cards stored before relations were canonicalised still hold Apple's
			// grouped pair; surface them so the editor is not blind to them, and
			// saving rewrites them as RELATED.
			case AB_RELATED_PROP:
				relations.push(
					legacyRelationFrom(p, labels.get(groupOf(p.name)) ?? ""),
				);
				break;
			case "BDAY":
				bday = dateStr(p);
				break;
			case "ANNIVERSARY":
				anniversary = dateStr(p);
				break;
			case "GENDER":
				gender = getText(p);
				break;
			case "GRAMGENDER":
				gramGender = getText(p);
				break;
			case "PRONOUNS":
				pronouns = getText(p);
				break;
			case "ORG":
				org = getText(p);
				break;
			case "TITLE":
				title = getText(p);
				break;
			case "NOTE":
				note = getText(p);
				break;
			case "CATEGORIES":
				categoriesCsv = categoriesFrom(p);
				break;
			case "PHOTO":
				photo = getText(p);
				break;
			default:
				parseTailProp(p, relations, otherProps);
				break;
		}
	}

	return {
		...emptyContactForm,
		kind,
		fn,
		familyName,
		givenName,
		middleName,
		prefix,
		suffix,
		nickname,
		emails,
		tels,
		urls,
		addresses,
		socialProfiles,
		impps,
		relations,
		bday,
		anniversary,
		gender,
		gramGender,
		pronouns,
		org,
		title,
		note,
		categoriesCsv,
		photo,
		otherProps,
	};
};
