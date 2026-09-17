import type { VNode } from "preact";
import { cx } from "./cx.ts";

// ---------------------------------------------------------------------------
// TagCombobox - a single bounded field holding the chosen tags as tokens with
// the text cursor after them, plus a dropdown of predefined options.
//
// The whole control reads as one input: the box carries the border and focus
// ring, the tokens sit inside it, and the entry field is a borderless input
// that grows to fill the remaining space. Clicking anywhere in the box puts the
// cursor in the entry.
//
// Submits a single comma-separated field, the same wire format as TagPicker, so
// either control can back the same server code. Without JavaScript the CSV text
// input is the control, exactly as before.
//
// Suggestions travel in a `data-suggestions` JSON attribute rather than an
// inline script, matching how the calendar page passes its config.
// ---------------------------------------------------------------------------

export interface TagComboboxProps {
	readonly id: string;
	/** Submitted field name. Receives the tags as CSV. */
	readonly name: string;
	readonly value: ReadonlyArray<string>;
	/** Offered in the dropdown; already-chosen tags are filtered out. */
	readonly suggestions?: ReadonlyArray<string>;
	/** Allow tags outside `suggestions`, committed with Enter or a comma. */
	readonly allowCustom?: boolean;
	readonly placeholder?: string;
	readonly class?: string;
}

const TagToken = ({ tag }: { tag: string }): VNode => (
	<span class="tag-token" data-tag-token data-tag={tag}>
		<span class="tag-token-label">{tag}</span>
		<button
			type="button"
			class="tag-token-remove"
			data-tag-remove
			tabIndex={-1}
			aria-label={`Remove ${tag}`}
		>
			<span aria-hidden="true">×</span>
		</button>
	</span>
);

export const TagCombobox = ({
	id,
	name,
	value,
	suggestions = [],
	allowCustom = false,
	placeholder = "Add tags…",
	class: cls,
}: TagComboboxProps): VNode => (
	<div
		class={cx("tag-combobox", cls)}
		data-tag-combobox
		data-allow-custom={allowCustom ? "" : undefined}
		data-suggestions={JSON.stringify(suggestions)}
	>
		<input
			type="text"
			id={id}
			name={name}
			value={value.join(", ")}
			placeholder="tag one, tag two"
			autocomplete="off"
			class="form-input"
			data-nojs-only
			data-tag-value
		/>

		<div class="tag-combobox-ui" data-js-only>
			{/* The tokens are direct children so they share the box's flex flow and
			    wrap alongside the entry, with no inner wrapper to lay out. */}
			<div class="tag-combobox-box" data-tag-box>
				{value.map((t) => (
					<TagToken key={t} tag={t} />
				))}
				<input
					type="text"
					id={`${id}-entry`}
					class="tag-combobox-entry"
					placeholder={placeholder}
					autocomplete="off"
					data-tag-entry
				/>
			</div>
			<ul id={`${id}-listbox`} class="listbox" data-tag-listbox hidden />
			<p class="sr-only" data-tag-status role="status" aria-live="polite" />
		</div>
	</div>
);
