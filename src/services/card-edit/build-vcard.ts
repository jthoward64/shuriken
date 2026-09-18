import { Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type {
	IrComponent,
	IrParameter,
	IrProperty,
	IrValue,
} from "#src/data/ir.ts";
import {
	RELATED_PROP,
	RELATION_NAME_PARAM,
	relationParams as relationTypeParams,
} from "#src/data/vcard/related.ts";
import { PHOTO_TYPE, PHOTO_TYPE_PHOTO } from "./field-registry.ts";
import { relationValueFromTarget } from "./relation-value.ts";
import type {
	ContactAddress,
	ContactFormData,
	ContactOtherProp,
	ContactRelation,
	ContactServiceValue,
	ContactTypedValue,
} from "./types.ts";

const YEARLESS_DATE = /^--(\d{2})-?(\d{2})$/u;

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
	parameters: typedParams(tv.types, tv.label, tv.preferred),
	value: { type: "TEXT", value: tv.value },
	isKnown: true,
});

export const telProp = (tv: ContactTypedValue): IrProperty => ({
	name: "TEL",
	parameters: typedParams(tv.types, tv.label, tv.preferred),
	value: { type: "TEXT", value: tv.value },
	isKnown: true,
});

export const urlProp = (value: string): IrProperty => uriProp("URL", value);

/** `Family;Given;Additional;Prefix;Suffix` from the form's five N components. */
export const nValue = (name: {
	readonly familyName: string;
	readonly givenName: string;
	readonly middleName: string;
	readonly prefix: string;
	readonly suffix: string;
}): string =>
	`${name.familyName};${name.givenName};${name.middleName};${name.prefix};${name.suffix}`;

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
	addressJoined(addr).replace(/;/gu, "") === "";

export const adrProp = (addr: ContactAddress): IrProperty => ({
	name: "ADR",
	parameters: typedParams(addr.types, addr.label, addr.preferred),
	value: { type: "TEXT", value: addressJoined(addr) },
	isKnown: true,
});

/** Parses an ISO date, absent when the value is not a valid calendar date */
const plainDateFrom = Option.liftThrowable((raw: string) =>
	Temporal.PlainDate.from(raw),
);

/**
 * BDAY value from raw input, absent when it should be omitted. YYYY-MM-DD →
 * DATE; yearless `--MMDD`/`--MM-DD` → TEXT (canonicalised to `--MMDD`).
 */
export const bdayValue = (raw: string): Option.Option<IrValue> => {
	if (!raw) {
		return Option.none();
	}
	const yearless = YEARLESS_DATE.exec(raw);
	if (yearless) {
		return Option.some({
			type: "TEXT",
			value: `--${yearless[1]}${yearless[2]}`,
		});
	}
	return Option.map(
		plainDateFrom(raw),
		(value): IrValue => ({ type: "DATE", value }),
	);
};

/** True when the raw BDAY/ANNIVERSARY input yields a value worth writing. */
export const hasBdayValue = (raw: string): boolean =>
	Option.isSome(bdayValue(raw));

/** BDAY/ANNIVERSARY value, falling back to the raw input as plain text. */
export const bdayValueOrText = (raw: string): IrValue =>
	Option.getOrElse(
		bdayValue(raw),
		(): IrValue => ({ type: "TEXT", value: raw }),
	);

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
	parameters: serviceParams(sv.service),
	value: { type: "URI", value: sv.value },
	isKnown: false,
});

export const imppProp = (sv: ContactServiceValue): IrProperty => ({
	name: "IMPP",
	parameters: serviceParams(sv.service),
	value: { type: "URI", value: sv.value },
	isKnown: true,
});

/** A relation row with nothing to point at — dropped rather than written. */
export const isBlankRelation = (relation: ContactRelation): boolean =>
	relationValueFromTarget(relation.target, relation.name).trim() === "";

/**
 * A `RELATED` property (RFC 6350 §6.6.6). The relation becomes a registered
 * TYPE token, with the wording preserved in a parameter when the token cannot
 * reproduce it; a URI target also carries the display name, so a downgrade to
 * 3.0 can show a name rather than a UID.
 */
export const relatedProp = (relation: ContactRelation): IrProperty => {
	const value = relationValueFromTarget(relation.target, relation.name);
	const isUri = relation.target.kind !== "text";
	const parameters: ReadonlyArray<IrParameter> = [
		{ name: "VALUE", value: isUri ? "uri" : "text" },
		...relationTypeParams(relation.relation),
		...(isUri && relation.name !== ""
			? [{ name: RELATION_NAME_PARAM, value: relation.name }]
			: []),
		...prefParams(relation.preferred),
	];
	return {
		name: RELATED_PROP,
		parameters,
		value: { type: isUri ? "URI" : "TEXT", value },
		isKnown: true,
	};
};

/**
 * Apple's photo companions for a newly set PHOTO. `X-IMAGEHASH` is deliberately
 * not synthesised: Apple's hash input is undocumented, and a hash we computed
 * differently would misdescribe the image more damagingly than its absence.
 */
export const photoMetaProps = (photo: string): ReadonlyArray<IrProperty> =>
	photo === "" ? [] : [textProp(PHOTO_TYPE, PHOTO_TYPE_PHOTO)];

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
	parameters: normalizeParamPref(parseParamString(o.params)),
	value: { type: "TEXT", value: o.value },
	isKnown: false,
});

/** KIND / N / NICKNAME, each omitted when its form fields are blank. */
const nameProps = (form: ContactFormData): ReadonlyArray<IrProperty> => {
	const out: Array<IrProperty> = [];
	if (form.kind !== "") {
		out.push(textProp("KIND", form.kind));
	}
	if (
		form.familyName !== "" ||
		form.givenName !== "" ||
		form.middleName !== "" ||
		form.prefix !== "" ||
		form.suffix !== ""
	) {
		out.push(textProp("N", nValue(form)));
	}
	if (form.nickname !== "") {
		out.push(textProp("NICKNAME", form.nickname));
	}
	return out;
};

/** The repeatable contact channels, with blank rows dropped. */
const channelProps = (form: ContactFormData): ReadonlyArray<IrProperty> => [
	...form.emails.filter((e) => e.value !== "").map(emailProp),
	...form.tels.filter((t) => t.value !== "").map(telProp),
	...form.urls.filter((u) => u !== "").map(urlProp),
	...form.addresses.filter((a) => !isBlankAddress(a)).map(adrProp),
	...form.socialProfiles.filter((sv) => sv.value !== "").map(socialProp),
	...form.impps.filter((im) => im.value !== "").map(imppProp),
	...form.relations.filter((r) => !isBlankRelation(r)).map(relatedProp),
];

/** BDAY / ANNIVERSARY, omitted when the raw value cannot be read as a date. */
const dateProps = (form: ContactFormData): ReadonlyArray<IrProperty> => [
	...Option.toArray(
		Option.map(bdayValue(form.bday), (value) => ({
			name: "BDAY",
			parameters: [],
			value,
			isKnown: true,
		})),
	),
	...Option.toArray(
		Option.map(bdayValue(form.anniversary), (value) => ({
			name: "ANNIVERSARY",
			parameters: [],
			value,
			isKnown: true,
		})),
	),
];

/** Single-valued descriptive fields, each omitted when blank. */
const SINGLE_TEXT_FIELDS: ReadonlyArray<
	readonly [
		string,
		keyof Pick<
			ContactFormData,
			"gender" | "gramGender" | "pronouns" | "org" | "title" | "note"
		>,
	]
> = [
	["GENDER", "gender"],
	["GRAMGENDER", "gramGender"],
	["PRONOUNS", "pronouns"],
	["ORG", "org"],
	["TITLE", "title"],
	["NOTE", "note"],
];

const descriptiveProps = (form: ContactFormData): ReadonlyArray<IrProperty> =>
	SINGLE_TEXT_FIELDS.filter(([, field]) => form[field] !== "").map(
		([name, field]) => textProp(name, form[field]),
	);

/** CATEGORIES, PHOTO and the generic editor rows. */
const extraProps = (form: ContactFormData): ReadonlyArray<IrProperty> => {
	const out: Array<IrProperty> = [];
	const categories = categoriesValue(form.categoriesCsv);
	if (categories.length > 0) {
		out.push({
			name: "CATEGORIES",
			parameters: [],
			value: { type: "TEXT_LIST", value: categories },
			isKnown: true,
		});
	}
	if (form.photo !== "") {
		// PHOTO accepts a URI (http(s):// or data:image/...;base64,...).
		out.push(uriProp("PHOTO", form.photo));
	}
	out.push(
		...form.otherProps.filter((o) => o.name.trim() !== "").map(otherProp),
	);
	return out;
};

export const buildVcardComponent = (
	uid: string,
	form: ContactFormData,
): IrComponent => {
	const properties: ReadonlyArray<IrProperty> = [
		textProp("VERSION", "4.0"),
		{
			name: "UID",
			parameters: [],
			value: { type: "URI", value: uid },
			isKnown: true,
		},
		textProp("FN", form.fn),
		...nameProps(form),
		...channelProps(form),
		...dateProps(form),
		...descriptiveProps(form),
		...extraProps(form),
	];
	return { name: "VCARD", properties, components: [] };
};
