import type { VNode } from "preact";
import { cx } from "../cx.ts";

// ---------------------------------------------------------------------------
// SearchPicker - text field backed by an incremental lookup against the
// server, for choosing one of something too numerous to render as a list
// (people, groups, timezones, collections).
//
// Generalizes the Share panel's principal lookup. The endpoint is a prop and
// the response is the JSON contract in helpers/search-picker.ts, so any
// endpoint can feed one.
//
// Without JavaScript this is a plain text input and nothing more: incremental
// lookup needs a round trip per keystroke, which cannot be expressed in HTML
// alone. What that costs is the candidate list, not the feature - the field
// still submits the typed identifier, and the server still resolves and
// validates it exactly as it would from the picker.
// ---------------------------------------------------------------------------

export interface SearchPickerProps {
	readonly id: string;
	/** Submitted field name; receives the chosen item's `value`. */
	readonly name: string;
	/** Endpoint returning `SearchPickerResponse`. */
	readonly endpoint: string;
	/** Current value, e.g. when re-rendering a form that failed validation. */
	readonly value?: string;
	/** Query-string parameter carrying the search text. */
	readonly queryParam?: string;
	/** Characters required before the first lookup. */
	readonly minLength?: number;
	readonly placeholder?: string;
	/** Shown when a search returns nothing. */
	readonly emptyLabel?: string;
	readonly required?: boolean;
	readonly class?: string;
}

export const SearchPicker = ({
	id,
	name,
	endpoint,
	value = "",
	queryParam = "q",
	minLength = 2,
	placeholder = "Search…",
	emptyLabel = "No matches",
	required = false,
	class: cls,
}: SearchPickerProps): VNode => (
	<div
		class={cx("search-picker", cls)}
		data-search-picker
		data-endpoint={endpoint}
		data-query-param={queryParam}
		data-min-length={String(minLength)}
		data-empty-label={emptyLabel}
	>
		<input
			type="text"
			id={id}
			name={name}
			value={value}
			placeholder={placeholder}
			required={required}
			autocomplete="off"
			class="form-input search-picker-input"
			data-search-input
		/>
		{/* Populated and given its combobox roles by the script; inert until then
		    so assistive tech is never told about a listbox that cannot open. */}
		<ul id={`${id}-listbox`} class="listbox" data-search-listbox hidden />
		<p
			class="search-picker-status sr-only"
			data-search-status
			role="status"
			aria-live="polite"
		/>
	</div>
);
