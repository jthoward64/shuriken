import type { IrComponent, IrProperty } from "#src/data/ir.ts";
import {
	baseName,
	getText,
	getTypeTokens,
	groupOf,
	hasPrefTypeToken,
	isPreferred,
	stripPrefToken,
} from "#src/data/vcard/prop.ts";
import { serializeParams } from "./build-vcard.ts";
import { isOtherEditable } from "./field-registry.ts";
import type {
	ContactAddress,
	ContactFormData,
	ContactOtherProp,
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

// Include `label` only when present, so label-free values stay `{value, types}`.
const labelPart = (p: IrProperty): { label?: string } => {
	const v = p.parameters.find((x) => x.name === "LABEL")?.value ?? "";
	return v === "" ? {} : { label: v };
};

// Canonical preference read: numeric PREF is authoritative, but honor a legacy
// `TYPE=pref` token for any card not yet upgraded on ingest. The `pref` token is
// stripped from `types` so preference lives on exactly one channel (`preferred`).
const prefAndTypes = (
	p: IrProperty,
): { types: ReadonlyArray<string>; preferred: boolean } => ({
	types: stripPrefToken(getTypeTokens(p)),
	preferred: isPreferred(p) || hasPrefTypeToken(p),
});

// ---------------------------------------------------------------------------
// parseVcardToForm — pre-populates the edit form from a vCard. It surfaces only
// the fields the form knows; properties it doesn't surface are NOT lost, because
// the write-back (`mergeFormIntoVcard`) carries every unmanaged property/param
// through verbatim. Matching is group-aware (`item1.EMAIL` → EMAIL) and reads
// repeated TYPE params, so Apple/Google vCard 3.0 populates correctly.
// ---------------------------------------------------------------------------

const splitAddress = (
	raw: string,
): Omit<ContactAddress, "types" | "preferred"> => {
	const parts = raw.split(";");
	return {
		poBox: parts[0] ?? "",
		extended: parts[1] ?? "",
		street: parts[2] ?? "",
		locality: parts[3] ?? "",
		region: parts[4] ?? "",
		postalCode: parts[5] ?? "",
		country: parts[6] ?? "",
	};
};

const dateStr = (p: IrProperty): string => {
	if (p.value.type === "DATE") {
		return p.value.value.toString();
	}
	return p.value.type === "TEXT" || p.value.type === "URI" ? p.value.value : "";
};

export const parseVcardToForm = (vcard: IrComponent): ContactFormData => {
	const emails: Array<ContactTypedValue> = [];
	const tels: Array<ContactTypedValue> = [];
	const urls: Array<string> = [];
	const addresses: Array<ContactAddress> = [];
	const socialProfiles: Array<ContactServiceValue> = [];
	const impps: Array<ContactServiceValue> = [];
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
				nickname =
					p.value.type === "TEXT_LIST"
						? [...p.value.value].join(", ")
						: getText(p);
				break;
			case "EMAIL":
				emails.push({
					value: getText(p),
					...prefAndTypes(p),
					...labelPart(p),
				});
				break;
			case "TEL":
				tels.push({
					value: getText(p),
					...prefAndTypes(p),
					...labelPart(p),
				});
				break;
			case "URL":
				urls.push(getText(p));
				break;
			case "ADR":
				addresses.push({
					...splitAddress(getText(p)),
					...prefAndTypes(p),
					...labelPart(p),
				});
				break;
			case "SOCIALPROFILE":
				socialProfiles.push({ service: serviceOf(p), value: getText(p) });
				break;
			case "IMPP":
				impps.push({ service: serviceOf(p), value: getText(p) });
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
				if (p.value.type === "TEXT_LIST") {
					categoriesCsv = [...p.value.value].join(", ");
				} else {
					categoriesCsv = getText(p);
				}
				break;
			case "PHOTO":
				photo = getText(p);
				break;
			default:
				if (isOtherEditable(p)) {
					otherProps.push({
						name: baseName(p.name),
						group: groupOf(p.name),
						value: getText(p),
						params: serializeParams(p.parameters),
					});
				}
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
