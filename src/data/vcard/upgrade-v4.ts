import type { IrDocument, IrParameter, IrProperty, IrValue } from "../ir.ts";
import {
	baseName,
	getTypeTokens,
	groupOf,
	hasPrefTypeToken,
	stripPrefToken,
} from "./prop.ts";

// ---------------------------------------------------------------------------
// vCard 2.1/3.0 → 4.0 canonical upgrade (RFC 6350 §A.1-A.2).
//
// Applied at ingest so all stored vCards converge on canonical 4.0. It is the
// exact inverse of `downgrade-v3.ts`: for every 4.0→3.0 mapping downgrade
// performs, upgrade reverses it, so a 3.0 client's edits (which arrive in the
// Apple/3.0 forms) re-canonicalize to 4.0 rather than degrading the stored copy.
//
// Reversible transforms: VERSION→4.0, TYPE=pref→PREF, structured GEO→geo: URI,
// bare-UUID UID→urn:uuid:, X-ADDRESSBOOKSERVER-KIND/MEMBER→KIND/MEMBER,
// X-GENDER→GENDER, grouped X-ABDATE(+Anniversary label)→ANNIVERSARY, and
// standalone LABEL→ADR;LABEL=. Everything else (deprecated/obsolete props, X-
// extensions, groups) passes through verbatim so no client data is lost.
//
// Two 3.0 limitations are irreversible and thus NOT round-trip-exact: PREF
// numeric ranking (3.0 has none → restored as PREF=1) and mandatory N (3.0
// requires it → downgrade may synthesize one). The 2.1 layer runs in vcard21.ts.
// ---------------------------------------------------------------------------

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ANNIVERSARY_LABEL = "_$!<Anniversary>!$_";

// Apple/3.0 extension name → canonical 4.0 name + value type (inverse of the
// downgrade renameToX mappings).
const X_TO_CANONICAL: ReadonlyMap<
	string,
	{ name: string; type: "TEXT" | "URI" }
> = new Map([
	["X-ADDRESSBOOKSERVER-KIND", { name: "KIND", type: "TEXT" }],
	["X-ADDRESSBOOKSERVER-MEMBER", { name: "MEMBER", type: "URI" }],
	["X-GENDER", { name: "GENDER", type: "TEXT" }],
]);

const isProp = (prop: IrProperty, base: string): boolean =>
	baseName(prop.name) === base;

/** String payload of the string-typed IrValue variants; "" otherwise. */
const rawStr = (value: IrValue): string =>
	typeof value.value === "string" ? value.value : "";

/** Replace a property's base name, preserving any `itemN.` group prefix. */
const replaceBase = (name: string, base: string): string => {
	const g = groupOf(name);
	return g === "" ? base : `${g}.${base}`;
};

/** Rebuild a property's parameters with a single comma-joined TYPE and optional extras. */
const withTypeParams = (
	prop: IrProperty,
	tokens: ReadonlyArray<string>,
	extra: ReadonlyArray<IrParameter>,
): ReadonlyArray<IrParameter> => [
	...prop.parameters.filter((p) => p.name !== "TYPE" && p.name !== "PREF"),
	...(tokens.length > 0 ? [{ name: "TYPE", value: tokens.join(",") }] : []),
	...extra,
];

/**
 * `TYPE=pref` → numeric `PREF=1` (3.0 boolean preference → 4.0 canonical).
 * Handles any casing, repeated/comma-joined TYPE params, and a pre-existing
 * numeric PREF (kept as-is). Group prefix is preserved (only params change).
 */
const upgradePref = (prop: IrProperty): IrProperty => {
	if (!hasPrefTypeToken(prop)) {
		return prop;
	}
	const tokens = stripPrefToken(getTypeTokens(prop));
	const pref = prop.parameters.find((p) => p.name === "PREF") ?? {
		name: "PREF",
		value: "1",
	};
	return { ...prop, parameters: withTypeParams(prop, tokens, [pref]) };
};

/**
 * 3.0 structured GEO `lat;lon` → 4.0 `geo:lat,lon` URI. Only a clean two-field
 * value is converted; anything already `geo:` or with a different field count
 * is left verbatim so no coordinate component is lost.
 */
const upgradeGeo = (prop: IrProperty): IrProperty => {
	if (!isProp(prop, "GEO") || prop.value.type !== "URI") {
		return prop;
	}
	const raw = prop.value.value;
	if (raw.startsWith("geo:")) {
		return prop;
	}
	const parts = raw.split(";");
	if (parts.length !== 2) {
		return prop;
	}
	return {
		...prop,
		value: { type: "URI", value: `geo:${parts[0] ?? ""},${parts[1] ?? ""}` },
	};
};

/** 3.0 bare-UUID UID → 4.0 `urn:uuid:` URI. Non-UUID UIDs are left untouched. */
const upgradeUid = (prop: IrProperty): IrProperty => {
	const raw = rawStr(prop.value);
	if (!isProp(prop, "UID") || !UUID_RE.test(raw)) {
		return prop;
	}
	return { ...prop, value: { type: "URI", value: `urn:uuid:${raw}` } };
};

/** Apple/3.0 extension → canonical 4.0 property (X-ADDRESSBOOKSERVER-KIND/MEMBER, X-GENDER). */
const uncanonicalizeX = (prop: IrProperty): IrProperty => {
	const target = X_TO_CANONICAL.get(baseName(prop.name));
	if (target === undefined) {
		return prop;
	}
	const raw = rawStr(prop.value);
	const value: IrValue =
		target.type === "URI"
			? { type: "URI", value: raw }
			: { type: "TEXT", value: raw };
	return {
		name: replaceBase(prop.name, target.name),
		parameters: prop.parameters,
		value,
		isKnown: true,
	};
};

/** Per-property upgrade — pure, never drops a property. */
const upgradeProperty = (prop: IrProperty): IrProperty =>
	upgradeUid(upgradeGeo(upgradePref(uncanonicalizeX(prop))));

/**
 * Grouped Apple anniversary (`itemN.X-ABDATE` + `itemN.X-ABLABEL:_$!<Anniversary>!$_`)
 * → a single canonical `ANNIVERSARY`, dropping both grouped members.
 */
const foldAnniversary = (
	props: ReadonlyArray<IrProperty>,
): ReadonlyArray<IrProperty> => {
	const groups = new Set<string>();
	for (const p of props) {
		const g = groupOf(p.name);
		if (
			g !== "" &&
			isProp(p, "X-ABLABEL") &&
			rawStr(p.value) === ANNIVERSARY_LABEL
		) {
			groups.add(g);
		}
	}
	if (groups.size === 0) {
		return props;
	}
	const out: Array<IrProperty> = [];
	for (const p of props) {
		const g = groupOf(p.name);
		if (g !== "" && groups.has(g)) {
			if (isProp(p, "X-ABDATE")) {
				out.push({
					name: "ANNIVERSARY",
					parameters: [],
					value: { type: "DATE_AND_OR_TIME", value: rawStr(p.value) },
					isKnown: true,
				});
				continue;
			}
			if (isProp(p, "X-ABLABEL")) {
				continue;
			}
		}
		out.push(p);
	}
	return out;
};

/**
 * Standalone 3.0 `LABEL` property → 4.0 `ADR;LABEL=` param on the ADR whose TYPE
 * tokens match (inverse of downgrade's ADR-label split). A LABEL that matches no
 * ADR is left standalone rather than dropped.
 */
const foldLabels = (
	props: ReadonlyArray<IrProperty>,
): ReadonlyArray<IrProperty> => {
	const labels = props.filter((p) => isProp(p, "LABEL"));
	if (labels.length === 0) {
		return props;
	}
	const folded = new Set<IrProperty>();
	const tokenSet = (p: IrProperty): Set<string> =>
		new Set(getTypeTokens(p).map((t) => t.toLowerCase()));
	const withLabel = props.map((p) => {
		if (!isProp(p, "ADR") || p.parameters.some((x) => x.name === "LABEL")) {
			return p;
		}
		const adrTypes = tokenSet(p);
		const match = labels.find((l) => {
			if (folded.has(l)) {
				return false;
			}
			const lt = tokenSet(l);
			return lt.size === adrTypes.size && [...lt].every((t) => adrTypes.has(t));
		});
		if (match === undefined) {
			return p;
		}
		folded.add(match);
		return {
			...p,
			parameters: [
				...p.parameters,
				{ name: "LABEL", value: rawStr(match.value) },
			],
		};
	});
	return withLabel.filter((p) => !(isProp(p, "LABEL") && folded.has(p)));
};

/** Ensure exactly one `VERSION` property with the given value, positioned first. */
const ensureVersion = (
	props: ReadonlyArray<IrProperty>,
	version: string,
): ReadonlyArray<IrProperty> => {
	const rest = props.filter((p) => !isProp(p, "VERSION"));
	const versionProp: IrProperty = {
		name: "VERSION",
		parameters: [],
		value: { type: "TEXT", value: version },
		isKnown: true,
	};
	return [versionProp, ...rest];
};

/** Normalize a vCard IrDocument to canonical 4.0. Non-vcard documents pass through. */
export const upgradeToV4 = (doc: IrDocument): IrDocument => {
	if (doc.kind !== "vcard") {
		return doc;
	}
	const perProp = doc.root.properties.map(upgradeProperty);
	const props = ensureVersion(foldLabels(foldAnniversary(perProp)), "4.0");
	return { ...doc, root: { ...doc.root, properties: props } };
};
