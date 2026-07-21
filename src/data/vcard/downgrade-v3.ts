import { formatPlainDate } from "../format-utils.ts";
import type { IrDocument, IrProperty, IrValue } from "../ir.ts";
import {
	baseName,
	getText,
	getTypeTokens,
	groupOf,
	stripPrefToken,
} from "./prop.ts";

// ---------------------------------------------------------------------------
// vCard 4.0 → 3.0 downgrade (RFC 2426), applied only when a client negotiates
// version 3.0. The inverse of `upgrade-v4.ts` plus Apple X- mappings for the
// 4.0-only properties real 3.0 clients (Apple/Google) expect. Renaming a
// managed property to `X-…` and marking it `isKnown: false` makes the codec
// emit it verbatim, which is what the lossless X- mapping needs.
//
// Downgrade is one-directional lossy in exactly one place: 3.0 has no PREF
// ranking, so numeric `PREF=N` collapses to a boolean `TYPE=pref` token.
// ---------------------------------------------------------------------------

const ANNIVERSARY_LABEL = "_$!<Anniversary>!$_";
const GEO_URI_PREFIX = "geo:";

/** 4.0-only VALUE= parameter tokens that 3.0 does not define. */
const V4_ONLY_VALUE: ReadonlySet<string> = new Set([
	"date-and-or-time",
	"timestamp",
	"language-tag",
]);

const isProp = (prop: IrProperty, base: string): boolean =>
	baseName(prop.name) === base;

/** String payload of the string-typed IrValue variants; "" for binary. */
const rawStr = (value: IrValue): string =>
	typeof value.value === "string" ? value.value : "";

/** String rendering of a value; a Temporal DATE is formatted in vCard basic form
 * (YYYYMMDD) to match the codec, so date round-trips are format-stable. */
const valueStr = (value: IrValue): string =>
	value.type === "DATE" ? formatPlainDate(value.value) : rawStr(value);

/** Replace a property's base name, preserving any `itemN.` group prefix. */
const replaceBase = (name: string, base: string): string => {
	const g = groupOf(name);
	return g === "" ? base : `${g}.${base}`;
};

/** Numeric `PREF=N` → 3.0 boolean `pref` TYPE token (ranking is dropped). */
const downgradePref = (prop: IrProperty): IrProperty => {
	if (!prop.parameters.some((p) => p.name === "PREF")) {
		return prop;
	}
	const tokens = [...stripPrefToken(getTypeTokens(prop)), "pref"];
	return {
		...prop,
		parameters: [
			...prop.parameters.filter((p) => p.name !== "TYPE" && p.name !== "PREF"),
			{ name: "TYPE", value: tokens.join(",") },
		],
	};
};

/** 4.0 `urn:uuid:` URI UID → 3.0 TEXT UID. */
const downgradeUid = (prop: IrProperty): IrProperty => {
	if (!isProp(prop, "UID")) {
		return prop;
	}
	return {
		...prop,
		value: {
			type: "TEXT",
			value: rawStr(prop.value).replace(/^urn:uuid:/i, ""),
		},
	};
};

/** 4.0 `geo:lat,lon` URI → 3.0 structured `lat;lon`. */
const downgradeGeo = (prop: IrProperty): IrProperty => {
	if (!isProp(prop, "GEO") || prop.value.type !== "URI") {
		return prop;
	}
	const raw = rawStr(prop.value);
	if (!raw.startsWith(GEO_URI_PREFIX)) {
		return prop;
	}
	// 3.0 GEO is `lat;lon` (2 fields only); a geo: URI altitude has no 3.0
	// equivalent and is dropped. isKnown:false → emitted verbatim so the `;`
	// field separator is not escaped.
	const coords = raw.slice(GEO_URI_PREFIX.length).split(",").slice(0, 2);
	return {
		...prop,
		value: { type: "TEXT", value: coords.join(";") },
		isKnown: false,
	};
};

/** Strip 4.0-only VALUE= params 3.0 rejects; unwrap `TEL;VALUE=uri` tel: URIs. */
const stripValueParam = (prop: IrProperty): IrProperty => {
	const valueParam = prop.parameters.find((p) => p.name === "VALUE");
	if (valueParam === undefined) {
		return prop;
	}
	const token = valueParam.value.toLowerCase();
	const withoutValue = prop.parameters.filter((p) => p.name !== "VALUE");
	if (isProp(prop, "TEL") && token === "uri") {
		const raw = rawStr(prop.value);
		return {
			...prop,
			parameters: withoutValue,
			value: { type: "TEXT", value: raw.replace(/^tel:/i, "") },
		};
	}
	if (isProp(prop, "TZ") && token === "utc-offset") {
		return { ...prop, parameters: withoutValue };
	}
	if (V4_ONLY_VALUE.has(token)) {
		return { ...prop, parameters: withoutValue };
	}
	return prop;
};

/** Split a 4.0 `ADR;LABEL=` param back into a correlated standalone 3.0 LABEL property. */
const splitAdrLabel = (prop: IrProperty): ReadonlyArray<IrProperty> => {
	if (!isProp(prop, "ADR")) {
		return [prop];
	}
	const labelParam = prop.parameters.find((p) => p.name === "LABEL");
	if (labelParam === undefined) {
		return [prop];
	}
	const adr = {
		...prop,
		parameters: prop.parameters.filter((p) => p.name !== "LABEL"),
	};
	const label: IrProperty = {
		name: replaceBase(prop.name, "LABEL"),
		parameters: prop.parameters.filter((p) => p.name === "TYPE"),
		value: { type: "TEXT", value: labelParam.value },
		isKnown: false,
	};
	return [adr, label];
};

/** Rename a 4.0-only property to an Apple X- equivalent, emitted verbatim. */
const renameToX = (prop: IrProperty, base: string): IrProperty => ({
	name: replaceBase(prop.name, base),
	parameters: prop.parameters,
	value: { type: "TEXT", value: rawStr(prop.value) },
	isKnown: false,
});

/** 4.0 ANNIVERSARY → Apple grouped `X-ABDATE` + `X-ABLABEL`. */
const anniversaryToAb = (
	prop: IrProperty,
	groupNum: number,
): ReadonlyArray<IrProperty> => {
	const group = `item${groupNum}`;
	return [
		{
			name: `${group}.X-ABDATE`,
			parameters: [],
			value: { type: "TEXT", value: valueStr(prop.value) },
			isKnown: false,
		},
		{
			name: `${group}.X-ABLABEL`,
			parameters: [],
			value: { type: "TEXT", value: ANNIVERSARY_LABEL },
			isKnown: false,
		},
	];
};

/** Highest existing `itemN` group index in the document, or 0. */
const maxItemGroup = (props: ReadonlyArray<IrProperty>): number => {
	let max = 0;
	for (const p of props) {
		const m = /^item(\d+)\./i.exec(p.name);
		const n = m?.[1];
		if (n !== undefined) {
			max = Math.max(max, Number.parseInt(n, 10));
		}
	}
	return max;
};

/** Ensure a `VERSION` property exists with the given value, positioned first. */
const ensureVersion = (
	props: ReadonlyArray<IrProperty>,
	version: string,
): ReadonlyArray<IrProperty> => [
	{
		name: "VERSION",
		parameters: [],
		value: { type: "TEXT", value: version },
		isKnown: true,
	},
	...props.filter((p) => !isProp(p, "VERSION")),
];

/** 3.0 requires N — synthesize it from FN when absent (RFC 2426 §3.1.2). */
const ensureN = (
	props: ReadonlyArray<IrProperty>,
): ReadonlyArray<IrProperty> => {
	if (props.some((p) => isProp(p, "N"))) {
		return props;
	}
	const fn = props.find((p) => isProp(p, "FN"));
	if (fn === undefined) {
		return props;
	}
	const n: IrProperty = {
		name: "N",
		parameters: [],
		value: { type: "TEXT", value: `${getText(fn)};;;;` },
		isKnown: true,
	};
	return [...props, n];
};

/** Downgrade a canonical 4.0 vCard IrDocument to 3.0. Non-vcard documents pass through. */
export const downgradeToV3 = (doc: IrDocument): IrDocument => {
	if (doc.kind !== "vcard") {
		return doc;
	}
	let group = maxItemGroup(doc.root.properties);
	const out: Array<IrProperty> = [];
	for (const prop of doc.root.properties) {
		const base = baseName(prop.name);
		if (base === "VERSION") {
			continue;
		}
		if (base === "KIND") {
			out.push(renameToX(prop, "X-ADDRESSBOOKSERVER-KIND"));
			continue;
		}
		if (base === "MEMBER") {
			out.push(renameToX(prop, "X-ADDRESSBOOKSERVER-MEMBER"));
			continue;
		}
		if (base === "ANNIVERSARY") {
			group += 1;
			out.push(...anniversaryToAb(prop, group));
			continue;
		}
		if (base === "GENDER") {
			// Preserve the full structured value (sex;identity) so upgrade can
			// restore GENDER exactly; drop only a wholly-empty GENDER.
			if (rawStr(prop.value) !== "") {
				out.push(renameToX(prop, "X-GENDER"));
			}
			continue;
		}
		const transformed = stripValueParam(
			downgradeGeo(downgradeUid(downgradePref(prop))),
		);
		out.push(...splitAdrLabel(transformed));
	}
	const props = ensureN(ensureVersion(out, "3.0"));
	return { ...doc, root: { ...doc.root, properties: props } };
};
