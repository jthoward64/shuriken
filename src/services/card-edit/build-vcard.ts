import { Temporal } from "temporal-polyfill";
import type { IrComponent, IrProperty } from "#src/data/ir.ts";
import type {
	ContactAddress,
	ContactFormData,
	ContactTypedValue,
} from "./types.ts";

// ---------------------------------------------------------------------------
// buildVcardComponent — pure mapper from a UI form to an IrComponent VCARD.
// Mirrors the field set in `types.ts`; everything is optional but FN.
//
// vCard 4 shape rules we encode here:
//   * N: `Family;Given;Additional;Prefix;Suffix` (semicolons even if empty)
//   * ADR: `PO;Ext;Street;Locality;Region;Postal;Country`
//   * EMAIL / TEL / URL: separate properties per value; TYPE=… as a parameter
//   * BDAY: ISO YYYY-MM-DD; parsed to PlainDate so DATE_AND_OR_TIME decoders
//     surface a proper Temporal value.
// ---------------------------------------------------------------------------

const textProp = (name: string, value: string): IrProperty => ({
	name,
	parameters: [],
	value: { type: "TEXT", value },
	isKnown: true,
});

const uriProp = (name: string, value: string): IrProperty => ({
	name,
	parameters: [],
	value: { type: "URI", value },
	isKnown: true,
});

const typedTextProp = (name: string, tv: ContactTypedValue): IrProperty => ({
	name,
	parameters:
		tv.types.length === 0 ? [] : [{ name: "TYPE", value: tv.types.join(",") }],
	value: { type: "TEXT", value: tv.value },
	isKnown: true,
});

const addressJoined = (addr: ContactAddress): string =>
	[
		addr.poBox,
		addr.extended,
		addr.street,
		addr.locality,
		addr.region,
		addr.postalCode,
		addr.country,
	].join(";");

/**
 * BDAY input handler.
 *
 * vCard 4 BDAY accepts full dates and yearless forms (RFC 6350 §4.3.4):
 *   * YYYY-MM-DD       → emit as DATE
 *   * --MMDD / --MM-DD → emit as TEXT (DATE has no representation for
 *                       yearless months/days)
 * Anything else returns null so the BDAY property is omitted.
 */
const tryParseBday = (
	raw: string,
):
	| { readonly date: Temporal.PlainDate; readonly raw?: never }
	| { readonly date?: never; readonly raw: string }
	| null => {
	if (!raw) {
		return null;
	}
	const yearlessMatch = raw.match(/^--(\d{2})-?(\d{2})$/);
	if (yearlessMatch) {
		// Re-emit canonical `--MMDD` so the on-the-wire form is stable
		// regardless of whether the user typed --1224 or --12-24.
		return { raw: `--${yearlessMatch[1]}${yearlessMatch[2]}` };
	}
	try {
		return { date: Temporal.PlainDate.from(raw) };
	} catch {
		return null;
	}
};

export const buildVcardComponent = (
	uid: string,
	form: ContactFormData,
): IrComponent => {
	const props: Array<IrProperty> = [
		textProp("VERSION", "4.0"),
		{
			name: "UID",
			parameters: [],
			value: { type: "URI", value: uid },
			isKnown: true,
		},
		textProp("FN", form.fn),
	];

	const hasName = form.familyName !== "" || form.givenName !== "";
	if (hasName) {
		props.push(textProp("N", `${form.familyName};${form.givenName};;;`));
	}

	for (const email of form.emails) {
		if (email.value !== "") {
			props.push(typedTextProp("EMAIL", email));
		}
	}
	for (const tel of form.tels) {
		if (tel.value !== "") {
			props.push(typedTextProp("TEL", tel));
		}
	}
	for (const url of form.urls) {
		if (url !== "") {
			props.push(uriProp("URL", url));
		}
	}
	for (const addr of form.addresses) {
		const joined = addressJoined(addr);
		if (joined.replace(/;/g, "") !== "") {
			props.push({
				name: "ADR",
				parameters:
					addr.types.length === 0
						? []
						: [{ name: "TYPE", value: addr.types.join(",") }],
				value: { type: "TEXT", value: joined },
				isKnown: true,
			});
		}
	}

	const bday = tryParseBday(form.bday);
	if (bday !== null) {
		props.push({
			name: "BDAY",
			parameters: [],
			value:
				bday.date !== undefined
					? { type: "DATE", value: bday.date }
					: { type: "TEXT", value: bday.raw },
			isKnown: true,
		});
	}

	if (form.org !== "") {
		props.push(textProp("ORG", form.org));
	}
	if (form.title !== "") {
		props.push(textProp("TITLE", form.title));
	}
	if (form.note !== "") {
		props.push(textProp("NOTE", form.note));
	}

	const categories = form.categoriesCsv
		.split(",")
		.map((c) => c.trim())
		.filter((c) => c !== "");
	if (categories.length > 0) {
		props.push({
			name: "CATEGORIES",
			parameters: [],
			value: { type: "TEXT_LIST", value: categories },
			isKnown: true,
		});
	}

	if (form.photo !== "") {
		// PHOTO accepts a URI (http(s):// or data:image/...;base64,...). We just
		// pass through whatever the form supplied.
		props.push(uriProp("PHOTO", form.photo));
	}

	return {
		name: "VCARD",
		properties: props,
		components: [],
	};
};
