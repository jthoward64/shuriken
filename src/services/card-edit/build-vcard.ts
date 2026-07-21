import { Temporal } from "temporal-polyfill";
import type {
	IrComponent,
	IrParameter,
	IrProperty,
	IrValue,
} from "#src/data/ir.ts";
import type {
	ContactAddress,
	ContactFormData,
	ContactOtherProp,
	ContactServiceValue,
	ContactTypedValue,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Form → IrComponent VCARD builders. The per-property builders and value
// helpers are exported so the structural-merge path (merge-vcard.ts) maps a
// form row to a property exactly the same way `buildVcardComponent` does.
//
// vCard shape rules:
//   * N: `Family;Given;Additional;Prefix;Suffix` (semicolons even if empty)
//   * ADR: `PO;Ext;Street;Locality;Region;Postal;Country`
//   * EMAIL / TEL / URL: separate properties per value; TYPE=… as a parameter
//   * BDAY: ISO YYYY-MM-DD → DATE; yearless `--MMDD` → TEXT
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

/**
 * `TYPE=a,b` parameter list for the given tokens (empty → no params).
 * A `pref` token is dropped defensively — preference is written only via
 * `prefParams` (numeric `PREF`), never as a TYPE token.
 */
export const typeParams = (
	types: ReadonlyArray<string>,
): ReadonlyArray<IrParameter> => {
	const tokens = types.filter((t) => t.toLowerCase() !== "pref");
	return tokens.length === 0 ? [] : [{ name: "TYPE", value: tokens.join(",") }];
};

/** `LABEL=…` parameter (RFC 9554 §4.5), or none when blank. */
export const labelParams = (
	label: string | undefined,
): ReadonlyArray<IrParameter> =>
	label && label !== "" ? [{ name: "LABEL", value: label }] : [];

/** `PREF=1` parameter (RFC 6350 §5.3), or none when not preferred. */
export const prefParams = (preferred: boolean): ReadonlyArray<IrParameter> =>
	preferred ? [{ name: "PREF", value: "1" }] : [];

/** TYPE + LABEL + PREF parameters for a typed value. */
const typedParams = (
	types: ReadonlyArray<string>,
	label: string | undefined,
	preferred: boolean,
): ReadonlyArray<IrParameter> => [
	...typeParams(types),
	...labelParams(label),
	...prefParams(preferred),
];

export const emailProp = (tv: ContactTypedValue): IrProperty => ({
	name: "EMAIL",
	parameters: [...typedParams(tv.types, tv.label, tv.preferred)],
	value: { type: "TEXT", value: tv.value },
	isKnown: true,
});

export const telProp = (tv: ContactTypedValue): IrProperty => ({
	name: "TEL",
	parameters: [...typedParams(tv.types, tv.label, tv.preferred)],
	value: { type: "TEXT", value: tv.value },
	isKnown: true,
});

export const urlProp = (value: string): IrProperty => uriProp("URL", value);

/** `Family;Given;Additional;Prefix;Suffix` from the form's five N components. */
export const nValue = (
	family: string,
	given: string,
	middle: string,
	prefix: string,
	suffix: string,
): string => `${family};${given};${middle};${prefix};${suffix}`;

export const addressJoined = (addr: ContactAddress): string =>
	[
		addr.poBox,
		addr.extended,
		addr.street,
		addr.locality,
		addr.region,
		addr.postalCode,
		addr.country,
	].join(";");

export const isBlankAddress = (addr: ContactAddress): boolean =>
	addressJoined(addr).replace(/;/g, "") === "";

export const adrProp = (addr: ContactAddress): IrProperty => ({
	name: "ADR",
	parameters: [...typedParams(addr.types, addr.label, addr.preferred)],
	value: { type: "TEXT", value: addressJoined(addr) },
	isKnown: true,
});

/**
 * BDAY value from raw input, or null to omit. YYYY-MM-DD → DATE; yearless
 * `--MMDD`/`--MM-DD` → TEXT (canonicalised to `--MMDD`).
 */
export const bdayValue = (raw: string): IrValue | null => {
	if (!raw) {
		return null;
	}
	const yearless = raw.match(/^--(\d{2})-?(\d{2})$/);
	if (yearless) {
		return { type: "TEXT", value: `--${yearless[1]}${yearless[2]}` };
	}
	try {
		return { type: "DATE", value: Temporal.PlainDate.from(raw) };
	} catch {
		return null;
	}
};

/** Non-empty, trimmed CATEGORIES tokens from a CSV string. */
export const categoriesValue = (csv: string): ReadonlyArray<string> =>
	csv
		.split(",")
		.map((c) => c.trim())
		.filter((c) => c !== "");

/** `SERVICE-TYPE=svc` parameter for SOCIALPROFILE/IMPP (RFC 9554 §4.9). */
export const serviceParams = (service: string): ReadonlyArray<IrParameter> =>
	service === "" ? [] : [{ name: "SERVICE-TYPE", value: service }];

export const socialProp = (sv: ContactServiceValue): IrProperty => ({
	name: "SOCIALPROFILE",
	parameters: [...serviceParams(sv.service)],
	value: { type: "URI", value: sv.value },
	isKnown: false,
});

export const imppProp = (sv: ContactServiceValue): IrProperty => ({
	name: "IMPP",
	parameters: [...serviceParams(sv.service)],
	value: { type: "URI", value: sv.value },
	isKnown: true,
});

// --- Generic ("other") property (de)serialisation -------------------------

/** Parse a `NAME=value;NAME=value` string into IR parameters. */
export const parseParamString = (raw: string): ReadonlyArray<IrParameter> =>
	raw
		.split(";")
		.map((s) => s.trim())
		.filter((s) => s !== "")
		.map((seg) => {
			const eq = seg.indexOf("=");
			return eq === -1
				? { name: seg, value: "" }
				: { name: seg.slice(0, eq).trim(), value: seg.slice(eq + 1).trim() };
		});

/** Serialise IR parameters back to a `NAME=value;NAME=value` string. */
export const serializeParams = (params: ReadonlyArray<IrParameter>): string =>
	params.map((p) => `${p.name}=${p.value}`).join(";");

/**
 * Fold a hand-typed `TYPE=pref` token (or bare `PREF`) into a numeric `PREF=1`
 * so the free-text params field stays on the single canonical preference channel.
 */
const normalizeParamPref = (
	params: ReadonlyArray<IrParameter>,
): ReadonlyArray<IrParameter> => {
	let sawPrefToken = false;
	const out: Array<IrParameter> = [];
	for (const p of params) {
		if (p.name.toUpperCase() === "TYPE") {
			const tokens = p.value
				.split(",")
				.map((t) => t.trim())
				.filter((t) => t !== "");
			const kept = tokens.filter((t) => t.toLowerCase() !== "pref");
			if (kept.length !== tokens.length) {
				sawPrefToken = true;
			}
			if (kept.length > 0) {
				out.push({ name: p.name, value: kept.join(",") });
			}
		} else if (p.name.toUpperCase() === "PREF" && p.value === "") {
			out.push({ name: "PREF", value: "1" });
		} else {
			out.push(p);
		}
	}
	if (sawPrefToken && !out.some((p) => p.name.toUpperCase() === "PREF")) {
		out.push({ name: "PREF", value: "1" });
	}
	return out;
};

/** Build a raw property from a generic editor row (value stored verbatim as TEXT). */
export const otherProp = (o: ContactOtherProp): IrProperty => ({
	name: o.group !== "" ? `${o.group}.${o.name}` : o.name,
	parameters: [...normalizeParamPref(parseParamString(o.params))],
	value: { type: "TEXT", value: o.value },
	isKnown: false,
});

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

	if (form.kind !== "") {
		props.push(textProp("KIND", form.kind));
	}
	if (
		form.familyName !== "" ||
		form.givenName !== "" ||
		form.middleName !== "" ||
		form.prefix !== "" ||
		form.suffix !== ""
	) {
		props.push(
			textProp(
				"N",
				nValue(
					form.familyName,
					form.givenName,
					form.middleName,
					form.prefix,
					form.suffix,
				),
			),
		);
	}
	if (form.nickname !== "") {
		props.push(textProp("NICKNAME", form.nickname));
	}

	for (const email of form.emails) {
		if (email.value !== "") {
			props.push(emailProp(email));
		}
	}
	for (const tel of form.tels) {
		if (tel.value !== "") {
			props.push(telProp(tel));
		}
	}
	for (const url of form.urls) {
		if (url !== "") {
			props.push(urlProp(url));
		}
	}
	for (const addr of form.addresses) {
		if (!isBlankAddress(addr)) {
			props.push(adrProp(addr));
		}
	}
	for (const sv of form.socialProfiles) {
		if (sv.value !== "") {
			props.push(socialProp(sv));
		}
	}
	for (const im of form.impps) {
		if (im.value !== "") {
			props.push(imppProp(im));
		}
	}

	const bday = bdayValue(form.bday);
	if (bday !== null) {
		props.push({ name: "BDAY", parameters: [], value: bday, isKnown: true });
	}
	const anniversary = bdayValue(form.anniversary);
	if (anniversary !== null) {
		props.push({
			name: "ANNIVERSARY",
			parameters: [],
			value: anniversary,
			isKnown: true,
		});
	}
	if (form.gender !== "") {
		props.push(textProp("GENDER", form.gender));
	}
	if (form.gramGender !== "") {
		props.push(textProp("GRAMGENDER", form.gramGender));
	}
	if (form.pronouns !== "") {
		props.push(textProp("PRONOUNS", form.pronouns));
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

	const categories = categoriesValue(form.categoriesCsv);
	if (categories.length > 0) {
		props.push({
			name: "CATEGORIES",
			parameters: [],
			value: { type: "TEXT_LIST", value: categories },
			isKnown: true,
		});
	}

	if (form.photo !== "") {
		// PHOTO accepts a URI (http(s):// or data:image/...;base64,...).
		props.push(uriProp("PHOTO", form.photo));
	}

	for (const o of form.otherProps) {
		if (o.name.trim() !== "") {
			props.push(otherProp(o));
		}
	}

	return {
		name: "VCARD",
		properties: props,
		components: [],
	};
};
