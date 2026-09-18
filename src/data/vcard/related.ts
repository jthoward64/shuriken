import type { IrParameter, IrProperty, IrValue } from "../ir.ts";
import { unwrapAppleLabel, wrapAppleLabel } from "./ab-label.ts";
import { baseName, getTypeTokens, groupOf } from "./prop.ts";

const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
const MAILTO_URI = /^mailto:(.+)$/iu;

// ---------------------------------------------------------------------------
// Apple `X-ABRELATEDNAMES` ↔ RFC 6350 §6.6.6 `RELATED`.
//
// Apple states a relationship as a grouped pair, the relation living entirely
// in a sibling label:
//
//   item2.X-ABRELATEDNAMES;TYPE=pref:Joshua Tag Howard
//   item2.X-ABLABEL:_$!<Spouse>!$_
//
// 4.0 states the same thing on one property, the relation as a TYPE token drawn
// from an IANA registry:
//
//   RELATED;VALUE=text;TYPE=spouse;PREF=1:Joshua Tag Howard
//
// The registry does not cover Apple's whole set (there is `parent` but no
// mother/father, no manager, no assistant), so mapping the token alone would
// quietly coarsen a relation and never recover it. The label is therefore
// preserved verbatim in `X-SKN-RELATION-LABEL` whenever the token alone would
// not reproduce it. The `any-param` alternative in the RELATED ABNF makes this
// conformant, and an `X-SKN-` prefix keeps it clear of the `X-AB…` namespace
// Apple owns.
//
// A URI-valued RELATED (a linked contact, or a mailto:) has no name to put in
// X-ABRELATEDNAMES, which is a display string. `X-SKN-RELATION-NAME` carries
// one so downgrade stays a pure function — no directory lookup, and never a
// bare UID written where a person's name belongs.
// ---------------------------------------------------------------------------

export const RELATED_PROP = "RELATED";
export const AB_RELATED_PROP = "X-ABRELATEDNAMES";
export const AB_LABEL_PROP = "X-ABLABEL";

/** Preserves the source relation label when the TYPE token cannot reproduce it. */
export const RELATION_LABEL_PARAM = "X-SKN-RELATION-LABEL";

/** Display name for a URI-valued RELATED, so 3.0 gets a name not a UID. */
export const RELATION_NAME_PARAM = "X-SKN-RELATION-NAME";

/**
 * The property a relation was folded from, when it was not Apple's grouped
 * pair. Downgrade writes the relation back in the form it arrived in, so an
 * Outlook card does not silently return from a 3.0 round-trip reshaped as an
 * Apple one.
 */
export const RELATION_SOURCE_PARAM = "X-SKN-RELATION-SOURCE";

/**
 * Single-property relation statements → the wording they mean. `AGENT` is the
 * standard 3.0 property RFC 6350 §A.2 replaced with `RELATED;TYPE=agent`; the
 * `X-` three are the Outlook/Google spellings of the same idea.
 */
const SOURCE_PROP_RELATION: ReadonlyMap<string, string> = new Map([
	["AGENT", "Agent"],
	["X-SPOUSE", "Spouse"],
	["X-MANAGER", "Manager"],
	["X-ASSISTANT", "Assistant"],
]);

/** Properties folded into RELATED besides Apple's grouped pair. */
export const RELATION_SOURCE_PROPS: ReadonlySet<string> = new Set(
	SOURCE_PROP_RELATION.keys(),
);

/** The relation a single-property form states, e.g. `X-MANAGER` → "Manager". */
export const relationForSourceProp = (base: string): string =>
	SOURCE_PROP_RELATION.get(base.toUpperCase()) ?? "";

/**
 * True when a preserved source property still describes the relation. Editing
 * an `X-SPOUSE`-sourced entry into a friend must not downgrade back to
 * `X-SPOUSE`, so the provenance is dropped once the wording moves away from it.
 */
export const sourceMatchesRelation = (
	source: string,
	relation: string,
): boolean =>
	(SOURCE_PROP_RELATION.get(source.toUpperCase()) ?? "").toLowerCase() ===
	relation.trim().toLowerCase();

/** The registered `related-type-value` set (RFC 6350 §6.6.6). */
export const RELATED_TYPE_VALUES: ReadonlyArray<string> = [
	"contact",
	"acquaintance",
	"friend",
	"met",
	"co-worker",
	"colleague",
	"co-resident",
	"neighbor",
	"child",
	"parent",
	"sibling",
	"spouse",
	"kin",
	"muse",
	"crush",
	"date",
	"sweetheart",
	"me",
	"agent",
	"emergency",
];

const RELATED_TYPE_SET: ReadonlySet<string> = new Set(RELATED_TYPE_VALUES);

// Apple built-in relation → the closest registered token. The keys double as
// the set of labels Apple localises, so a token that is also a key is written
// back wrapped.
const APPLE_TO_TYPE: ReadonlyMap<string, string> = new Map([
	["father", "parent"],
	["mother", "parent"],
	["parent", "parent"],
	["brother", "sibling"],
	["sister", "sibling"],
	["child", "child"],
	["friend", "friend"],
	["spouse", "spouse"],
	["partner", "spouse"],
	["assistant", "agent"],
	["manager", "co-worker"],
	["other", "contact"],
]);

/** Fallback token for a relation with no registered equivalent at all. */
const GENERIC_TYPE = "contact";

const paramValue = (prop: IrProperty, name: string): string | undefined =>
	prop.parameters.find((p) => p.name.toUpperCase() === name)?.value;

const withoutParams = (
	prop: IrProperty,
	names: ReadonlyArray<string>,
): ReadonlyArray<IrParameter> => {
	const drop = new Set(names);
	return prop.parameters.filter((p) => !drop.has(p.name.toUpperCase()));
};

/** String payload of the string-typed IrValue variants; "" otherwise. */
const rawStr = (value: IrValue): string =>
	typeof value.value === "string" ? value.value : "";

/** Replace a property's base name, preserving any `itemN.` group prefix. */
const replaceBase = (name: string, base: string): string => {
	const g = groupOf(name);
	return g === "" ? base : `${g}.${base}`;
};

/** Title-case a registered token for display: `co-worker` → `Co-worker`. */
const titleCase = (token: string): string =>
	token.charAt(0).toUpperCase() + token.slice(1);

/** Relation wording → registered token, falling back to the generic one. */
const typeForRelation = (relation: string): string => {
	const key = relation.trim().toLowerCase();
	return (
		APPLE_TO_TYPE.get(key) ?? (RELATED_TYPE_SET.has(key) ? key : GENERIC_TYPE)
	);
};

/**
 * The X-ABLABEL a downgrade would synthesise from `token` alone. Comparing the
 * source label against this is what decides whether the label parameter is
 * needed: if they match, the token already carries the whole relation.
 */
const labelFromToken = (token: string): string =>
	APPLE_TO_TYPE.has(token)
		? wrapAppleLabel(titleCase(token))
		: titleCase(token);

/** Anything that begins a nested vCard — 3.0 AGENT's third value form. */
const EMBEDDED_VCARD = /^\s*BEGIN:VCARD/iu;

/** A scheme-prefixed value, i.e. a URI rather than a person's name. */
const URI_LIKE = URI_SCHEME;

/**
 * Where an `AGENT` carrying a whole nested vCard is parked in 4.0. RELATED
 * holds a URI or a name, never a card, and 4.0 dropped AGENT — so rather than
 * flatten it to something wrong, it keeps its value under an X- name and
 * downgrade restores it.
 */
export const EMBEDDED_AGENT_PROP = "X-AGENT";

// ---------------------------------------------------------------------------
// Upgrade: grouped Apple pair (and the single-property forms) → RELATED
// ---------------------------------------------------------------------------

/**
 * A single-property relation statement → canonical `RELATED`, remembering which
 * property it came from. The wording is implied by the property name, so it
 * goes through the same parameter builder as an editor-authored relation.
 */
const upgradeSourceProp = (prop: IrProperty, base: string): IrProperty => {
	const wording = SOURCE_PROP_RELATION.get(base) ?? "";
	const raw = rawStr(prop.value);
	const isUri =
		paramValue(prop, "VALUE")?.toLowerCase() === "uri" || URI_LIKE.test(raw);
	return {
		name: RELATED_PROP,
		parameters: [
			{ name: "VALUE", value: isUri ? "uri" : "text" },
			...withoutParams(prop, ["VALUE", "TYPE"]),
			...relationParams(wording),
			{ name: RELATION_SOURCE_PARAM, value: base },
		],
		value: { type: isUri ? "URI" : "TEXT", value: raw },
		isKnown: true,
	};
};

/**
 * Fold every relation statement into a canonical `RELATED`: Apple's grouped
 * `X-ABRELATEDNAMES` (+ its sibling `X-ABLABEL`, dropped with it), and the
 * single-property `AGENT` / `X-SPOUSE` / `X-MANAGER` / `X-ASSISTANT` forms. A
 * group that also holds other properties keeps its label, since something else
 * still needs it.
 */
export const upgradeRelated = (
	props: ReadonlyArray<IrProperty>,
): ReadonlyArray<IrProperty> => {
	const relatedGroups = new Set<string>();
	let sawSourceProp = false;
	for (const p of props) {
		const base = baseName(p.name);
		if (base === AB_RELATED_PROP) {
			relatedGroups.add(groupOf(p.name));
		} else if (RELATION_SOURCE_PROPS.has(base)) {
			sawSourceProp = true;
		}
	}
	if (relatedGroups.size === 0 && !sawSourceProp) {
		return props;
	}

	const sharedGroups = new Set<string>();
	const labels = new Map<string, string>();
	for (const p of props) {
		const g = groupOf(p.name);
		if (g === "" || !relatedGroups.has(g)) {
			continue;
		}
		const base = baseName(p.name);
		if (base === AB_LABEL_PROP) {
			labels.set(g, rawStr(p.value));
		} else if (base !== AB_RELATED_PROP) {
			sharedGroups.add(g);
		}
	}

	const out: Array<IrProperty> = [];
	for (const p of props) {
		const g = groupOf(p.name);
		const base = baseName(p.name);
		if (base === AB_RELATED_PROP) {
			const rawLabel = labels.get(g) ?? "";
			const relation = unwrapAppleLabel(rawLabel);
			const token = relation === "" ? GENERIC_TYPE : typeForRelation(relation);
			const needsLabel = rawLabel !== "" && rawLabel !== labelFromToken(token);
			out.push({
				name: RELATED_PROP,
				parameters: [
					{ name: "VALUE", value: "text" },
					...withoutParams(p, ["VALUE", "TYPE"]),
					{ name: "TYPE", value: token },
					...(needsLabel
						? [{ name: RELATION_LABEL_PARAM, value: rawLabel }]
						: []),
				],
				value: { type: "TEXT", value: rawStr(p.value) },
				isKnown: true,
			});
			continue;
		}
		if (
			base === AB_LABEL_PROP &&
			relatedGroups.has(g) &&
			!sharedGroups.has(g)
		) {
			continue;
		}
		if (RELATION_SOURCE_PROPS.has(base)) {
			// An AGENT holding a nested vCard has no RELATED equivalent; park it
			// under X-AGENT so 4.0 keeps it and downgrade can hand it back. The
			// provenance marker is what makes that reversible: a client's own
			// X-AGENT, which we never parked, must not be renamed to AGENT.
			if (base === "AGENT" && EMBEDDED_VCARD.test(rawStr(p.value))) {
				out.push({
					...p,
					name: replaceBase(p.name, EMBEDDED_AGENT_PROP),
					parameters: [
						...p.parameters,
						{ name: RELATION_SOURCE_PARAM, value: "AGENT" },
					],
				});
				continue;
			}
			out.push(upgradeSourceProp(p, base));
			continue;
		}
		out.push(p);
	}
	return out;
};

// ---------------------------------------------------------------------------
// Downgrade: RELATED → grouped Apple pair
// ---------------------------------------------------------------------------

/**
 * Display string for X-ABRELATEDNAMES, which Apple renders as a person's name.
 * A preserved name wins; then a text value; then a `mailto:` address. A bare
 * URI has no name — undefined, and the caller leaves RELATED alone rather than
 * writing a UID where a name belongs.
 */
const displayNameForDowngrade = (prop: IrProperty): string | undefined => {
	const preserved = paramValue(prop, RELATION_NAME_PARAM);
	if (preserved !== undefined && preserved !== "") {
		return preserved;
	}
	const raw = rawStr(prop.value);
	if (raw === "") {
		return undefined;
	}
	const valueParam = paramValue(prop, "VALUE")?.toLowerCase();
	if (valueParam === "text") {
		return raw;
	}
	const mailto = MAILTO_URI.exec(raw);
	if (mailto?.[1] !== undefined) {
		return mailto[1];
	}
	// A TEXT-typed value with no VALUE=text param is still free text (that is
	// how a 3.0-authored card arrives); only a real URI has no display form.
	return prop.value.type === "TEXT" && !URI_SCHEME.test(raw) ? raw : undefined;
};

/**
 * A canonical `RELATED` → Apple's grouped `X-ABRELATEDNAMES` + `X-ABLABEL`.
 * Returns the property unchanged (as a single-element list) when it carries no
 * name to display — a 3.0 client ignores the unknown property, which is better
 * than showing it a UID.
 */
/**
 * Rebuild the single property this relation was folded from, or undefined when
 * that form cannot hold the current value — only AGENT is defined to take a
 * URI, so a linked contact under an `X-` source falls back to Apple's pair,
 * which knows how to find a display name.
 */
const downgradeToSource = (
	prop: IrProperty,
	source: string,
): IrProperty | undefined => {
	const raw = rawStr(prop.value);
	const isUri =
		prop.value.type === "URI" ||
		paramValue(prop, "VALUE")?.toLowerCase() === "uri";
	if (isUri && source !== "AGENT") {
		return undefined;
	}
	const preferred = prop.parameters.some(
		(p) => p.name.toUpperCase() === "PREF",
	);
	return {
		name: source,
		parameters: [
			...(isUri ? [{ name: "VALUE", value: "uri" }] : []),
			...withoutParams(prop, [
				"VALUE",
				"TYPE",
				"PREF",
				RELATION_LABEL_PARAM,
				RELATION_NAME_PARAM,
				RELATION_SOURCE_PARAM,
			]),
			...(preferred ? [{ name: "TYPE", value: "pref" }] : []),
		],
		// isKnown:false → emitted verbatim, so a URI keeps its `:` separators.
		value: { type: "TEXT", value: raw },
		isKnown: false,
	};
};

export const downgradeRelated = (
	prop: IrProperty,
	groupNum: number,
): ReadonlyArray<IrProperty> => {
	const source = paramValue(prop, RELATION_SOURCE_PARAM);
	if (source !== undefined && source !== "") {
		const restored = downgradeToSource(prop, source);
		if (restored !== undefined) {
			return [restored];
		}
	}
	const name = displayNameForDowngrade(prop);
	if (name === undefined) {
		return [prop];
	}
	const group = `item${groupNum}`;
	const preserved = paramValue(prop, RELATION_LABEL_PARAM);
	const token = getTypeTokens(prop)[0];
	const label =
		preserved !== undefined && preserved !== ""
			? preserved
			: token === undefined
				? ""
				: labelFromToken(token.toLowerCase());
	// TYPE carries the relation, which moves to the label, so the whole
	// parameter goes — including 3.0's boolean preference marker, re-added from
	// the numeric PREF (the generic downgradePref never sees this property).
	const preferred = prop.parameters.some(
		(p) => p.name.toUpperCase() === "PREF",
	);
	return [
		{
			name: `${group}.${AB_RELATED_PROP}`,
			parameters: [
				...withoutParams(prop, [
					"VALUE",
					"TYPE",
					"PREF",
					RELATION_LABEL_PARAM,
					RELATION_NAME_PARAM,
					// Provenance for a form we are not writing here would be a lie.
					RELATION_SOURCE_PARAM,
				]),
				...(preferred ? [{ name: "TYPE", value: "pref" }] : []),
			],
			value: { type: "TEXT", value: name },
			isKnown: false,
		},
		...(label === ""
			? []
			: [
					{
						name: `${group}.${AB_LABEL_PROP}`,
						parameters: [],
						value: { type: "TEXT", value: label } as IrValue,
						isKnown: false,
					},
				]),
	];
};

/**
 * `TYPE` (+ the label parameter when the token cannot reproduce the wording)
 * for a relation the editor is writing. Blank relation → no parameters.
 */
export const relationParams = (
	relation: string,
): ReadonlyArray<IrParameter> => {
	const trimmed = relation.trim();
	if (trimmed === "") {
		return [];
	}
	const token = typeForRelation(trimmed);
	// The editor's wording is unwrapped, so compare against the unwrapped form
	// of what the token alone would produce.
	const needsLabel = trimmed !== unwrapAppleLabel(labelFromToken(token));
	return [
		{ name: "TYPE", value: token },
		...(needsLabel ? [{ name: RELATION_LABEL_PARAM, value: trimmed }] : []),
	];
};

/**
 * An `X-AGENT` we parked → the `AGENT` it came from, marker stripped. Returns
 * undefined for an `X-AGENT` we did not park, which is a client's own property
 * and must keep its name.
 */
export const restoreEmbeddedAgent = (
	prop: IrProperty,
): IrProperty | undefined => {
	if (paramValue(prop, RELATION_SOURCE_PARAM) !== "AGENT") {
		return undefined;
	}
	return {
		...prop,
		name: replaceBase(prop.name, "AGENT"),
		parameters: withoutParams(prop, [RELATION_SOURCE_PARAM]),
	};
};

/** Display relation for a canonical RELATED: preserved label, else its token. */
export const relationOf = (prop: IrProperty): string => {
	const preserved = paramValue(prop, RELATION_LABEL_PARAM);
	if (preserved !== undefined && preserved !== "") {
		return unwrapAppleLabel(preserved);
	}
	const token = getTypeTokens(prop)[0];
	return token === undefined ? "" : titleCase(token.toLowerCase());
};
