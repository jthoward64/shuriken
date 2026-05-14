import type { IrComponent, IrProperty } from "#src/data/ir.ts";
import type {
	ContactAddress,
	ContactFormData,
	ContactTypedValue,
} from "./types.ts";
import { emptyContactForm } from "./types.ts";

// ---------------------------------------------------------------------------
// parseVcardToForm — inverse of `buildVcardComponent`. Loses some fidelity
// for properties the UI doesn't surface (NICKNAME, ROLE, IMPP, …): those
// fields are dropped here, which means an edit-save round-trip would erase
// them. Documented limitation of the v1 UI — clients still see them via
// CardDAV REPORT. A future revision can either preserve unknown props in
// a hidden form field or replace this with a structural-merge.
// ---------------------------------------------------------------------------

const textOf = (p: IrProperty): string =>
	p.value.type === "TEXT" || p.value.type === "URI" ? p.value.value : "";

const typesParam = (p: IrProperty): ReadonlyArray<string> => {
	const t = p.parameters.find((pp) => pp.name === "TYPE");
	if (!t || t.value === "") {
		return [];
	}
	return t.value.split(",").map((s) => s.trim()).filter((s) => s !== "");
};

const splitAddress = (raw: string): Omit<ContactAddress, "types"> => {
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

export const parseVcardToForm = (vcard: IrComponent): ContactFormData => {
	const emails: Array<ContactTypedValue> = [];
	const tels: Array<ContactTypedValue> = [];
	const urls: Array<string> = [];
	const addresses: Array<ContactAddress> = [];
	let fn = "";
	let familyName = "";
	let givenName = "";
	let bday = "";
	let org = "";
	let title = "";
	let note = "";
	let categoriesCsv = "";
	let photo = "";

	for (const p of vcard.properties) {
		switch (p.name) {
			case "FN":
				fn = textOf(p);
				break;
			case "N": {
				const parts = textOf(p).split(";");
				familyName = parts[0] ?? "";
				givenName = parts[1] ?? "";
				break;
			}
			case "EMAIL":
				emails.push({ value: textOf(p), types: typesParam(p) });
				break;
			case "TEL":
				tels.push({ value: textOf(p), types: typesParam(p) });
				break;
			case "URL":
				urls.push(textOf(p));
				break;
			case "ADR":
				addresses.push({ ...splitAddress(textOf(p)), types: typesParam(p) });
				break;
			case "BDAY":
				if (p.value.type === "DATE") {
					bday = p.value.value.toString();
				} else if (p.value.type === "TEXT" || p.value.type === "URI") {
					bday = p.value.value;
				}
				break;
			case "ORG":
				org = textOf(p);
				break;
			case "TITLE":
				title = textOf(p);
				break;
			case "NOTE":
				note = textOf(p);
				break;
			case "CATEGORIES":
				if (p.value.type === "TEXT_LIST") {
					categoriesCsv = [...p.value.value].join(", ");
				} else {
					categoriesCsv = textOf(p);
				}
				break;
			case "PHOTO":
				photo = textOf(p);
				break;
			default:
				break;
		}
	}

	return {
		...emptyContactForm,
		fn,
		familyName,
		givenName,
		emails,
		tels,
		urls,
		addresses,
		bday,
		org,
		title,
		note,
		categoriesCsv,
		photo,
	};
};
