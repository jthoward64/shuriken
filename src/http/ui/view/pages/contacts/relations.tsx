import type { VNode } from "preact";
import { RELATED_TYPE_VALUES } from "#src/data/vcard/related.ts";
import type { ContactRelation } from "#src/services/card-edit/types.ts";
import { Badge } from "../../components/display.tsx";

// ---------------------------------------------------------------------------
// Relations — the `RELATED` rows, shared between the editor form and the
// preview pane.
//
// A relation points at one of three things, and each renders differently: a
// contact on this server (a link), an email address (a mailto:), or just a
// name. The editor keeps that a single text box with a type-ahead rather than a
// mode switch: picking a suggestion fills the hidden UID field, and anything
// else is classified server-side (see relation-value.ts). With no JS the box is
// an ordinary text input and the value is stored as free text.
// ---------------------------------------------------------------------------

/**
 * The relation value input's field name. htmx includes a requesting input's own
 * name/value in the query string, so the suggestion endpoint reads the search
 * term under this name — hence the shared constant rather than two literals
 * that could drift apart.
 */
export const RELATION_NAME_FIELD = "relations[].name";

/** Relation wordings offered in the dropdown, in Apple's presentation order. */
const COMMON_RELATIONS: ReadonlyArray<string> = [
	"Spouse",
	"Partner",
	"Child",
	"Parent",
	"Mother",
	"Father",
	"Brother",
	"Sister",
	"Friend",
	"Assistant",
	"Manager",
];

/**
 * The dropdown's options for one row: the common wordings, the registered
 * `related-type-value` tokens not already covered, and — only on the row that
 * carries it — whatever non-standard wording the stored card used, so editing a
 * contact never silently coarsens its relation.
 */
export const relationOptionsFor = (current: string): ReadonlyArray<string> => {
	const seen = new Set(COMMON_RELATIONS.map((r) => r.toLowerCase()));
	const out = [...COMMON_RELATIONS];
	for (const token of RELATED_TYPE_VALUES) {
		if (!seen.has(token)) {
			seen.add(token);
			out.push(token.charAt(0).toUpperCase() + token.slice(1));
		}
	}
	const trimmed = current.trim();
	if (trimmed !== "" && !seen.has(trimmed.toLowerCase())) {
		out.unshift(trimmed);
	}
	return out;
};

/** A contact offered by the type-ahead. */
export interface RelationOption {
	readonly uid: string;
	readonly fn: string;
	readonly org: string;
}

/**
 * The `<datalist>` swapped in by the type-ahead. Options carry the UID in a
 * data attribute; contacts.js copies it into the row's hidden field when the
 * typed value matches an option exactly.
 */
export const RelationOptions = ({
	listId,
	options,
}: {
	listId: string;
	options: ReadonlyArray<RelationOption>;
}): VNode => (
	<datalist id={listId}>
		{options.map((o) => (
			<option key={o.uid} value={o.fn} data-uid={o.uid}>
				{o.org}
			</option>
		))}
	</datalist>
);

/** How a stored relation should be presented in the viewer. */
export interface ResolvedRelation {
	readonly relation: ContactRelation;
	/** Set when the target is a contact that resolved to a live card. */
	readonly href?: string;
	/** Text to show — the resolved contact's current name where available. */
	readonly label: string;
}

/** Read-only relation list for the preview pane. */
export const RelationList = ({
	relations,
}: {
	relations: ReadonlyArray<ResolvedRelation>;
}): VNode => (
	<ul class="space-y-1.5">
		{relations.map((r, i) => (
			<li key={`${r.label}-${i}`} class="flex items-center gap-2">
				<div class="min-w-0 flex-1">
					{r.href !== undefined ? (
						<a href={r.href} class="link break-words text-sm">
							{r.label}
						</a>
					) : r.relation.target.kind === "email" ? (
						<a
							href={`mailto:${r.relation.target.address}`}
							class="link break-words text-sm"
						>
							{r.label}
						</a>
					) : (
						<span
							class={
								r.relation.target.kind === "contact"
									? "break-words text-sm text-subtle"
									: "break-words text-sm text-fg"
							}
							// A contact reference we could not resolve is shown as the raw
							// UID: honest about what is stored, and never a broken link.
							title={
								r.relation.target.kind === "contact"
									? "This contact is not in this address book"
									: undefined
							}
						>
							{r.label}
						</span>
					)}
					{r.relation.relation !== "" && (
						<span class="ml-2 text-xs text-subtle">{r.relation.relation}</span>
					)}
				</div>
				{r.relation.preferred && (
					<Badge tone="brand" class="shrink-0">
						Preferred
					</Badge>
				)}
			</li>
		))}
	</ul>
);
