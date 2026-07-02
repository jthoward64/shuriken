/** biome-ignore-all lint/style/useNamingConvention: tagged-union discriminants use _tag */
import { Schema } from "effect";
import type { InstanceId } from "#src/domain/ids.ts";

// ---------------------------------------------------------------------------
// Contact cleanup model.
//
// A `CleanupSuggestion` is one detected problem on one vCard, presented to the
// user with Fix / Ignore actions. The embedded `CleanupFix` is the concrete,
// serialisable intent that `apply-fix.ts` applies to the vCard IR. It is round-
// tripped through the browser as JSON (a hidden form field) and re-validated at
// the HTTP edge via `CleanupFixSchema`, so it must stay a plain data shape.
//
// `occurrence` is the 0-based index of the target property among same-named
// properties on the card (e.g. the 2nd EMAIL). `current` snapshots the value at
// scan time; apply-fix refuses to act if the card no longer matches (stale scan).
// ---------------------------------------------------------------------------

export const CleanupFixSchema = Schema.Union([
	Schema.TaggedStruct("SetPhone", {
		occurrence: Schema.Number,
		current: Schema.String,
		next: Schema.String,
	}),
	Schema.TaggedStruct("LowercaseEmail", {
		occurrence: Schema.Number,
		current: Schema.String,
		next: Schema.String,
	}),
	Schema.TaggedStruct("SetNameCase", {
		field: Schema.Literals(["N", "FN"]),
		current: Schema.String,
		next: Schema.String,
	}),
	Schema.TaggedStruct("RemoveDuplicate", {
		propName: Schema.Literals(["EMAIL", "TEL"]),
		occurrence: Schema.Number,
		value: Schema.String,
	}),
	Schema.TaggedStruct("SetLabel", {
		propName: Schema.Literals(["EMAIL", "TEL"]),
		occurrence: Schema.Number,
		// The offending TYPE token to remove (e.g. "VALUE"), not the whole param.
		current: Schema.String,
		// null → just remove the junk token; else also add this token.
		newType: Schema.NullOr(Schema.String),
	}),
	// Apple X-ABLabel (vCard 3.0): targets the occurrence-th X-ABLABEL property.
	Schema.TaggedStruct("SetAbLabel", {
		occurrence: Schema.Number,
		current: Schema.String,
		// null → remove the X-ABLABEL property; else set it to _$!<newLabel>!$_.
		newLabel: Schema.NullOr(Schema.String),
	}),
]);

export type CleanupFix = Schema.Schema.Type<typeof CleanupFixSchema>;

// Typed constructors for each fix. Centralising construction keeps the `_tag`
// discriminant in one place (rather than scattered object literals) and gives
// analyzers a clean, misuse-resistant API.

export const setPhoneFix = (
	occurrence: number,
	current: string,
	next: string,
): CleanupFix => ({ _tag: "SetPhone", occurrence, current, next });

export const lowercaseEmailFix = (
	occurrence: number,
	current: string,
	next: string,
): CleanupFix => ({ _tag: "LowercaseEmail", occurrence, current, next });

export const setNameCaseFix = (
	field: "N" | "FN",
	current: string,
	next: string,
): CleanupFix => ({ _tag: "SetNameCase", field, current, next });

export const removeDuplicateFix = (
	propName: "EMAIL" | "TEL",
	occurrence: number,
	value: string,
): CleanupFix => ({ _tag: "RemoveDuplicate", propName, occurrence, value });

export const setLabelFix = (
	propName: "EMAIL" | "TEL",
	occurrence: number,
	current: string,
	newType: string | null,
): CleanupFix => ({ _tag: "SetLabel", propName, occurrence, current, newType });

export const setAbLabelFix = (
	occurrence: number,
	current: string,
	newLabel: string | null,
): CleanupFix => ({ _tag: "SetAbLabel", occurrence, current, newLabel });

export type CleanupCategory =
	| "phone"
	| "email"
	| "name"
	| "duplicate"
	| "label";

/** Extra input the UI must collect before a fix can be applied. */
export type CleanupInput = "areaCode" | "label";

/**
 * A suggestion without the per-card identity fields. Analyzers return these;
 * `analyzeCard` attaches `id`, `instanceId`, and `contactFn`.
 */
export interface PartialSuggestion {
	readonly category: CleanupCategory;
	readonly title: string;
	readonly description: string;
	readonly current: string;
	/** Human-facing proposed value; "" when it depends on user input. */
	readonly proposed: string;
	readonly fix: CleanupFix;
	readonly needsInput?: CleanupInput;
	/** Selectable TYPE labels for the `label` input. */
	readonly labelOptions?: ReadonlyArray<string>;
	/** Region carried through for the `areaCode` input recompute. */
	readonly region?: string;
}

export interface CleanupSuggestion extends PartialSuggestion {
	/** Stable DOM id, unique within a scan. */
	readonly id: string;
	readonly instanceId: InstanceId;
	readonly contactFn: string;
}
