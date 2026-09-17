import type { JSX, VNode } from "preact";
import { cx } from "./cx.ts";

// ---------------------------------------------------------------------------
// Select - a real <select> opted into the customizable-select styling.
//
// Browsers that support `appearance: base-select` (see styles/input.css) render
// the author-supplied <button>/<selectedcontent> trigger and the full markup
// inside each <option>, so options can carry an icon and a description line.
// Browsers that do not support it ignore the <button> entirely and render a
// classic OS dropdown, so this is purely additive: the element is always a
// native <select> that submits, validates and keyboard-navigates normally,
// with no JavaScript involved either way.
//
// Fallback caveat: a non-supporting browser renders only an option's
// textContent, which would concatenate the label and description into one
// string. Rich options therefore also carry a `label` attribute, which those
// browsers display in preference to the text content. Plain options omit it so
// the attribute is never load-bearing where it is not needed.
//
// Only single-selection dropdowns are covered. `<select multiple>` and
// `<select size>` (the "customizable listbox" shapes) are deliberately not
// used: their base styling is not supported widely enough to rely on.
// ---------------------------------------------------------------------------

// Module augmentation is the only way to teach JSX about a new intrinsic
// element, and it has no form that avoids a namespace
declare module "preact" {
	// biome-ignore lint/style/useNamingConvention: JSX is preact's own namespace name
	// biome-ignore lint/style/noNamespace: required shape for a JSX intrinsic-element augmentation
	namespace JSX {
		interface IntrinsicElements {
			/** Clone of the selected <option>'s content, shown inside the trigger. */
			selectedcontent: JSX.HTMLAttributes<HTMLElement>;
		}
	}
}

export interface SelectOption {
	readonly value: string;
	readonly label: string;
	/** Secondary line shown under the label in the picker. */
	readonly description?: string;
	/** Short glyph shown before the label. Decorative only. */
	readonly icon?: string;
	readonly disabled?: boolean;
}

export type SelectProps = Omit<
	JSX.SelectHTMLAttributes<HTMLSelectElement>,
	"class" | "value" | "children"
> & {
	/** Omit for a client-side-only control, so it submits nothing of its own. */
	readonly name?: string;
	readonly options: ReadonlyArray<SelectOption>;
	/** Value of the option to preselect. */
	readonly value?: string;
	readonly class?: string;
};

const isRich = (o: SelectOption): boolean =>
	o.description !== undefined || o.icon !== undefined;

const Option = ({
	option,
	selected,
}: {
	option: SelectOption;
	selected: boolean;
}): VNode =>
	isRich(option) ? (
		<option
			value={option.value}
			label={option.label}
			selected={selected}
			disabled={option.disabled}
			class="select-option"
		>
			{option.icon !== undefined && (
				<span class="select-option-icon" aria-hidden="true">
					{option.icon}
				</span>
			)}
			<span class="select-option-body">
				<span class="select-option-label">{option.label}</span>
				{option.description !== undefined && (
					<span class="select-option-desc">{option.description}</span>
				)}
			</span>
		</option>
	) : (
		<option value={option.value} selected={selected} disabled={option.disabled}>
			{option.label}
		</option>
	);

export const Select = ({
	name,
	options,
	value,
	class: cls,
	...rest
}: SelectProps): VNode => (
	<select {...rest} name={name} class={cx("form-select", cls)}>
		{/* Ignored wholesale by browsers without base-select support */}
		<button type="button">
			<selectedcontent />
		</button>
		{options.map((o) => (
			<Option key={o.value} option={o} selected={o.value === value} />
		))}
	</select>
);
