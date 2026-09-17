import type { VNode } from "preact";
import { cx } from "../cx.ts";
import { Select } from "../form/select.tsx";

// ---------------------------------------------------------------------------
// TagPicker - chip-style editor for a comma-separated list of tags.
//
// The submitted value is always a single CSV field, matching the existing
// `categoriesCsv` shape, so a form can adopt this control without the server
// side changing.
//
// Without JavaScript the CSV text input is the control: visible, editable and
// submitted as-is. The browser script hides it (via the `data-nojs-only`
// convention, so there is no flash) and drives it from the chip UI, which is
// server-rendered with the current tags already in place.
//
// Superseded by TagCombobox (view/tag-combobox.tsx), which puts the whole
// control in one box. Kept as the alternative built on a real <select>, for
// cases that want the native dropdown rather than a token field.
//
// Adding a tag goes through a real <select>, which is what gets the
// customizable-select styling. Free-text entry is a separate input shown only
// when `allowCustom` is set, rather than a "create" row inside the dropdown:
// an <option> cannot host a text field, and a multi-select would lose base
// styling in browsers that only support the single-dropdown shape.
// ---------------------------------------------------------------------------

export interface TagPickerProps {
	readonly id: string;
	/** Submitted field name. Receives the tags as CSV. */
	readonly name: string;
	readonly value: ReadonlyArray<string>;
	/** Offered in the add dropdown; already-chosen tags are filtered out by the script. */
	readonly suggestions?: ReadonlyArray<string>;
	/** Show a free-text input for tags outside `suggestions`. */
	readonly allowCustom?: boolean;
	readonly placeholder?: string;
	readonly class?: string;
}

const TagChip = ({ tag }: { tag: string }): VNode => (
	<li class="tag-chip" data-tag-chip data-tag={tag}>
		<span class="tag-chip-label">{tag}</span>
		<button
			type="button"
			class="tag-chip-remove"
			data-tag-remove
			aria-label={`Remove ${tag}`}
		>
			<span aria-hidden="true">×</span>
		</button>
	</li>
);

export const TagPicker = ({
	id,
	name,
	value,
	suggestions = [],
	allowCustom = false,
	placeholder = "tag one, tag two",
	class: cls,
}: TagPickerProps): VNode => {
	const addId = `${id}-add`;
	const customId = `${id}-custom`;
	return (
		<div
			class={cx("tag-picker", cls)}
			data-tag-picker
			data-allow-custom={allowCustom ? "" : undefined}
		>
			<input
				type="text"
				id={id}
				name={name}
				value={value.join(", ")}
				placeholder={placeholder}
				autocomplete="off"
				class="form-input"
				data-nojs-only
				data-tag-value
			/>

			<div class="tag-picker-ui" data-js-only data-tag-ui>
				<ul class="tag-list" data-tag-list>
					{value.map((t) => (
						<TagChip key={t} tag={t} />
					))}
				</ul>
				<p class="tag-picker-empty" data-tag-empty hidden={value.length > 0}>
					No tags yet.
				</p>

				<div class="tag-picker-add">
					<label for={addId} class="sr-only">
						Add a tag
					</label>
					{/* Unnamed so the picker never submits a stray field of its own */}
					<Select
						id={addId}
						data-tag-add
						value=""
						options={[
							{ value: "", label: "Add a tag…" },
							...suggestions.map((s) => ({ value: s, label: s })),
						]}
					/>

					{allowCustom && (
						<>
							<label for={customId} class="sr-only">
								New tag
							</label>
							{/* No Add button: this half of the control only ever renders
							    when the script is present, and the script commits on Enter,
							    so a button would be a second way to do the same thing. */}
							<input
								type="text"
								id={customId}
								class="form-input tag-picker-custom"
								placeholder="New tag, then Enter"
								autocomplete="off"
								data-tag-custom
							/>
						</>
					)}
				</div>
			</div>
		</div>
	);
};
