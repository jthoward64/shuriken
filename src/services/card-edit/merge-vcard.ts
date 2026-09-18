import type { IrComponent, IrProperty, IrValue } from "#src/data/ir.ts";
import { baseName, getText, groupOf } from "#src/data/vcard/prop.ts";
import {
	AB_RELATED_PROP,
	RELATED_PROP,
	RELATION_LABEL_PARAM,
	RELATION_NAME_PARAM,
	RELATION_SOURCE_PARAM,
	RELATION_SOURCE_PROPS,
	sourceMatchesRelation,
} from "#src/data/vcard/related.ts";
import {
	addressJoined,
	adrProp,
	bdayValueOrText,
	categoriesValue,
	emailProp,
	hasBdayValue,
	imppProp,
	isBlankAddress,
	isBlankRelation,
	labelParams,
	nValue,
	otherProp,
	photoMetaProps,
	prefParams,
	relatedProp,
	serviceParams,
	socialProp,
	telProp,
	typeParams,
	urlProp,
} from "./build-vcard.ts";
import {
	isOtherEditable,
	PHOTO_CONTENT_META_BASES,
	PHOTO_CROP_PARAM,
	PHOTO_META_BASES,
	PHOTO_TYPE,
} from "./field-registry.ts";
import type {
	ContactFormData,
	ContactRelation,
	ContactServiceValue,
} from "./types.ts";

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

type Multi =
	| "EMAIL"
	| "TEL"
	| "URL"
	| "ADR"
	| "SOCIALPROFILE"
	| "IMPP"
	| "RELATED";
const MULTI: ReadonlyArray<Multi> = [
	"EMAIL",
	"TEL",
	"URL",
	"ADR",
	"SOCIALPROFILE",
	"IMPP",
	"RELATED",
];

/**
 * The managed family a property belongs to. Apple's legacy grouped
 * `X-ABRELATEDNAMES` joins the RELATED family so a card holding both forms
 * pairs against one row list, and saving rewrites it canonically.
 */
const multiKeyOf = (base: string): string =>
	base === AB_RELATED_PROP || RELATION_SOURCE_PROPS.has(base)
		? "RELATED"
		: base;

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
	channel: {
		readonly types: ReadonlyArray<string>;
		readonly label?: string;
		readonly preferred: boolean;
	},
): IrProperty => ({
	...prop,
	parameters: [
		...prop.parameters.filter(
			(p) => p.name !== "TYPE" && p.name !== "LABEL" && p.name !== "PREF",
		),
		...typeParams(channel.types),
		...labelParams(channel.label),
		...prefParams(channel.preferred),
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

// Parameters relatedProp owns; anything else on an existing RELATED (PID,
// ALTID, …) is the client's and survives the edit.
const RELATION_MANAGED_PARAMS: ReadonlySet<string> = new Set([
	"VALUE",
	"TYPE",
	"PREF",
	RELATION_LABEL_PARAM,
	RELATION_NAME_PARAM,
]);

/**
 * Update a relation in place. A legacy grouped `X-ABRELATEDNAMES` is rebuilt
 * outright rather than patched — the whole point is to leave canonical RELATED
 * behind, and its group prefix must not survive.
 */
const withRelation = (
	prop: IrProperty,
	relation: ContactRelation,
): IrProperty => {
	const rebuilt = relatedProp(relation);
	if (baseName(prop.name) !== RELATED_PROP) {
		return rebuilt;
	}
	return {
		...rebuilt,
		name: prop.name,
		parameters: [
			...prop.parameters.filter((p) => {
				const name = p.name.toUpperCase();
				if (RELATION_MANAGED_PARAMS.has(name)) {
					return false;
				}
				// Provenance only holds while the wording still means what the
				// source property means — retyping a spouse as a friend must not
				// downgrade back to X-SPOUSE.
				return (
					name !== RELATION_SOURCE_PARAM ||
					sourceMatchesRelation(p.value, relation.relation)
				);
			}),
			...rebuilt.parameters,
		],
	};
};

const multiRows = (
	form: ContactFormData,
): Record<Multi, ReadonlyArray<unknown>> => ({
	EMAIL: form.emails.filter((e) => e.value !== ""),
	TEL: form.tels.filter((t) => t.value !== ""),
	URL: form.urls.filter((u) => u !== ""),
	ADR: form.addresses.filter((a) => !isBlankAddress(a)),
	SOCIALPROFILE: form.socialProfiles.filter((s) => s.value !== ""),
	IMPP: form.impps.filter((i) => i.value !== ""),
	RELATED: form.relations.filter((r) => !isBlankRelation(r)),
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
			return withTypedValue(prop, tv.value, tv);
		}
		case "URL":
			return withValue(prop, {
				type: prop.value.type === "TEXT" ? "TEXT" : "URI",
				value: row as string,
			});
		case "ADR": {
			const addr = row as ContactFormData["addresses"][number];
			return withTypedValue(prop, addressJoined(addr), addr);
		}
		case "SOCIALPROFILE":
		case "IMPP":
			return withServiceValue(prop, row as ContactServiceValue);
		case "RELATED":
			return withRelation(prop, row as ContactRelation);
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
		case "RELATED":
			return relatedProp(row as ContactRelation);
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
			return hasBdayValue(form.bday);
		case "ANNIVERSARY":
			return hasBdayValue(form.anniversary);
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
			return text(nValue(form));
		case "BDAY":
			return bdayValueOrText(form.bday);
		case "ANNIVERSARY":
			return bdayValueOrText(form.anniversary);
		case "CATEGORIES":
			return {
				type: "TEXT_LIST",
				value: categoriesValue(form.categoriesCsv),
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

/**
 * Reconcile Apple's photo companions against a changed PHOTO. `X-IMAGEHASH` and
 * the `X-ABCROP-RECTANGLE` parameter both describe the *old* image's bytes — a
 * surviving crop would frame the new photo by the old one's coordinates — so
 * both are dropped and left for a client to recompute. `X-IMAGETYPE` is a
 * discriminator we can state correctly, so it is kept in step.
 */
const reconcilePhotoMeta = (
	props: ReadonlyArray<IrProperty>,
	form: ContactFormData,
	photoChanged: boolean,
): ReadonlyArray<IrProperty> => {
	const hasPhoto = form.photo !== "";
	const kept = props.filter((p) => {
		const base = baseName(p.name);
		if (base === PHOTO_TYPE) {
			return false;
		}
		if (!PHOTO_META_BASES.has(base)) {
			return true;
		}
		return !(photoChanged && PHOTO_CONTENT_META_BASES.has(base));
	});
	const withoutStaleCrop = kept.map((p) =>
		photoChanged && baseName(p.name) === "PHOTO"
			? {
					...p,
					parameters: p.parameters.filter(
						(x) => x.name.toUpperCase() !== PHOTO_CROP_PARAM,
					),
				}
			: p,
	);
	return hasPhoto
		? [...withoutStaleCrop, ...photoMetaProps(form.photo)]
		: withoutStaleCrop;
};

/** Mutable bookkeeping carried through one merge pass. */
interface MergeState {
	readonly rows: Record<Multi, ReadonlyArray<unknown>>;
	readonly cursor: Record<Multi, number>;
	readonly singleEmitted: Set<Single>;
	readonly removedGroups: Set<string>;
	readonly seenHeaders: Set<string>;
	readonly out: Array<IrProperty>;
}

const newMergeState = (form: ContactFormData): MergeState => ({
	rows: multiRows(form),
	cursor: {
		EMAIL: 0,
		TEL: 0,
		URL: 0,
		ADR: 0,
		SOCIALPROFILE: 0,
		IMPP: 0,
		RELATED: 0,
	},
	singleEmitted: new Set<Single>(),
	removedGroups: new Set<string>(),
	seenHeaders: new Set<string>(),
	out: [],
});

/** Re-emits one existing repeatable property against the next matching form row. */
const mergeMultiProp = (
	state: MergeState,
	base: string,
	prop: IrProperty,
): void => {
	const m = multiKeyOf(base) as Multi;
	const list = state.rows[m];
	const i = state.cursor[m];
	state.cursor[m] = i + 1;
	const g = groupOf(prop.name);
	// A legacy grouped related name leaves as an ungrouped RELATED either
	// way, so its label is orphaned whether the row survived or not.
	if (g !== "" && (i >= list.length || base === AB_RELATED_PROP)) {
		state.removedGroups.add(g);
	}
	if (i < list.length) {
		state.out.push(updateMulti(m, prop, list[i]));
	}
};

/** Walks the stored card, rewriting form-owned properties and keeping the rest verbatim. */
const mergeExistingProps = (
	existing: IrComponent,
	form: ContactFormData,
	state: MergeState,
): void => {
	for (const p of existing.properties) {
		const base = baseName(p.name);
		if (base === "VERSION" || base === "UID") {
			state.out.push(p);
			state.seenHeaders.add(base);
			continue;
		}
		if ((MULTI as ReadonlyArray<string>).includes(multiKeyOf(base))) {
			mergeMultiProp(state, base, p);
			continue;
		}
		if ((SINGLE as ReadonlyArray<string>).includes(base)) {
			const single = base as Single;
			state.singleEmitted.add(single);
			if (hasSingle(single, form)) {
				state.out.push(updateSingle(single, p, form));
			}
			continue;
		}
		// Generic editor owns these — drop; the form's otherProps rows replace them.
		if (isOtherEditable(p)) {
			continue;
		}
		// Metadata / X-ABLABEL / exotic-typed tail → verbatim.
		state.out.push(p);
	}
};

/** Appends the form rows that had no counterpart in the stored card. */
const appendNewRows = (form: ContactFormData, state: MergeState): void => {
	for (const m of MULTI) {
		for (let i = state.cursor[m]; i < state.rows[m].length; i++) {
			state.out.push(buildMulti(m, state.rows[m][i]));
		}
	}
	for (const s of SINGLE) {
		if (!state.singleEmitted.has(s) && hasSingle(s, form)) {
			state.out.push(buildSingle(s, form));
		}
	}
	for (const o of form.otherProps) {
		if (o.name.trim() !== "") {
			state.out.push(otherProp(o));
		}
	}
};

/** Restores the VERSION/UID headers the stored card did not carry. */
const ensureHeaders = (state: MergeState, uid: string): void => {
	if (!state.seenHeaders.has("UID")) {
		state.out.unshift({
			name: "UID",
			parameters: [],
			value: { type: "URI", value: uid },
			isKnown: true,
		});
	}
	if (!state.seenHeaders.has("VERSION")) {
		state.out.unshift({
			name: "VERSION",
			parameters: [],
			value: { type: "TEXT", value: "4.0" },
			isKnown: true,
		});
	}
};

/** Drops X-ABLABEL rows whose group lost every property it labelled. */
const pruneOrphanLabels = (
	props: ReadonlyArray<IrProperty>,
	removedGroups: ReadonlySet<string>,
): ReadonlyArray<IrProperty> =>
	props.filter((p) => {
		if (baseName(p.name) !== "X-ABLABEL") {
			return true;
		}
		const g = groupOf(p.name);
		if (g === "" || !removedGroups.has(g)) {
			return true;
		}
		return props.some(
			(q) =>
				q !== p && groupOf(q.name) === g && baseName(q.name) !== "X-ABLABEL",
		);
	});

export const mergeFormIntoVcard = (
	existing: IrComponent,
	form: ContactFormData,
	uid: string,
): IrComponent => {
	const state = newMergeState(form);
	mergeExistingProps(existing, form, state);
	appendNewRows(form, state);
	ensureHeaders(state, uid);

	const photoChanged =
		getText(existing.properties.find((p) => baseName(p.name) === "PHOTO")) !==
		form.photo;
	const reconciled = reconcilePhotoMeta(state.out, form, photoChanged);
	const pruned = pruneOrphanLabels(reconciled, state.removedGroups);

	return { name: "VCARD", properties: pruned, components: existing.components };
};
