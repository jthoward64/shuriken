import type { VNode } from "preact";
import { cx } from "./cx.ts";

// ---------------------------------------------------------------------------
// DateField / DateRangeField - date and date-range entry with a three-step
// fallback chain, best first:
//
//   1. JavaScript: a calendar popover (two months side by side for ranges,
//      with quick presets), styled to match the rest of the UI.
//   2. No JavaScript: the native <input type="date"> / "datetime-local"
//      control, including its own picker and validation.
//   3. Neither: a browser that does not implement the date input types puts
//      the element into text state, where the `pattern` attribute applies and
//      validates the typed value. This is why `pattern` is set on an input
//      whose type attribute is `date`: the attribute is inert while the date
//      type is supported, and becomes the validation rule when it is not.
//
// The value format is identical at every step (`YYYY-MM-DD`, or
// `YYYY-MM-DDTHH:mm` in datetime mode), so the server parses one shape.
// ---------------------------------------------------------------------------

export type DateFieldMode = "date" | "datetime";

/**
 * Stated wherever a time is entered.
 *
 * Entered times are stored as RFC 5545 floating values: no TZID, no `Z` (see
 * services/cal-edit/build-vevent.ts). That is the codebase's deliberate stance,
 * and it is what "local time" means here - the same clock time in every client,
 * rather than a fixed instant. Saying so is the difference between a choice and
 * a surprise, so a datetime field says it by default.
 */
export const FLOATING_TIME_NOTE = "Local time, saved without a timezone.";

const NATIVE_TYPE: Record<DateFieldMode, string> = {
	date: "date",
	datetime: "datetime-local",
};

const PATTERN: Record<DateFieldMode, string> = {
	date: "\\d{4}-\\d{2}-\\d{2}",
	datetime: "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}",
};

const FORMAT_HINT: Record<DateFieldMode, string> = {
	date: "YYYY-MM-DD",
	datetime: "YYYY-MM-DDTHH:mm",
};

/** Ranges the popover offers as one-click choices. Resolved in the browser's timezone. */
export type DateRangePreset =
	| "today"
	| "yesterday"
	| "last-7-days"
	| "last-30-days"
	| "this-month"
	| "last-month"
	| "this-year";

const DEFAULT_PRESETS: ReadonlyArray<DateRangePreset> = [
	"today",
	"yesterday",
	"last-7-days",
	"last-30-days",
	"this-month",
	"last-month",
];

export interface DateFieldProps {
	readonly id: string;
	readonly name: string;
	readonly value?: string;
	readonly mode?: DateFieldMode;
	readonly min?: string;
	readonly max?: string;
	readonly required?: boolean;
	/** Overrides the floating-time note; pass "" to suppress it. */
	readonly zoneNote?: string;
	readonly class?: string;
}

/** Single date (or date-time) input with a calendar popover once scripted */
export const DateField = ({
	id,
	name,
	value = "",
	mode = "date",
	min,
	max,
	required = false,
	zoneNote = FLOATING_TIME_NOTE,
	class: cls,
}: DateFieldProps): VNode => {
	// A date carries no time, so it raises no timezone question at all
	const note = mode === "datetime" ? zoneNote : "";
	return (
		<>
			<div
				class={cx("datefield", cls)}
				data-date-field
				data-mode={mode}
				data-zone-note={note === "" ? undefined : note}
			>
				<input
					type={NATIVE_TYPE[mode]}
					id={id}
					name={name}
					value={value}
					min={min}
					max={max}
					required={required}
					pattern={PATTERN[mode]}
					placeholder={FORMAT_HINT[mode]}
					title={`Format: ${FORMAT_HINT[mode]}`}
					class="form-input datefield-input"
					data-date-input
				/>
				<button
					type="button"
					class="datefield-trigger"
					data-js-only
					data-date-trigger
					aria-label="Choose date"
					aria-haspopup="dialog"
					aria-expanded="false"
				>
					<span aria-hidden="true">🗓</span>
				</button>
			</div>
			{/* Server-rendered, so the no-JS path states it too */}
			{note !== "" && <p class="form-hint">{note}</p>}
		</>
	);
};

export interface DateRangeFieldProps {
	/** Namespaces the two inputs' ids. */
	readonly id: string;
	readonly startName: string;
	readonly endName: string;
	readonly startValue?: string;
	readonly endValue?: string;
	readonly mode?: DateFieldMode;
	readonly min?: string;
	readonly max?: string;
	readonly required?: boolean;
	/** Pass an empty array to hide the preset column. */
	readonly presets?: ReadonlyArray<DateRangePreset>;
	readonly startLabel?: string;
	readonly endLabel?: string;
	/** Overrides the floating-time note; pass "" to suppress it. */
	readonly zoneNote?: string;
	readonly class?: string;
}

/**
 * Paired start/end dates sharing one calendar popover.
 *
 * Renders as two independent native inputs until the script runs, so the
 * no-JS path is two ordinary date fields rather than a broken range widget.
 */
export const DateRangeField = ({
	id,
	startName,
	endName,
	startValue = "",
	endValue = "",
	mode = "date",
	min,
	max,
	required = false,
	presets = DEFAULT_PRESETS,
	startLabel = "From",
	endLabel = "To",
	zoneNote = FLOATING_TIME_NOTE,
	class: cls,
}: DateRangeFieldProps): VNode => {
	const note = mode === "datetime" ? zoneNote : "";
	// Stated once for the pair rather than under each end, which would say the
	// same thing twice about one range
	const part = (
		partId: string,
		label: string,
		fieldName: string,
		fieldValue: string,
	): VNode => (
		<div class="date-range-part">
			<label for={partId} class="form-label">
				{label}
			</label>
			<DateField
				id={partId}
				name={fieldName}
				value={fieldValue}
				mode={mode}
				min={min}
				max={max}
				required={required}
				zoneNote=""
			/>
		</div>
	);
	return (
		<div
			class={cx("date-range", cls)}
			data-date-range
			data-mode={mode}
			data-presets={presets.join(",")}
			data-zone-note={note === "" ? undefined : note}
		>
			{part(`${id}-start`, startLabel, startName, startValue)}
			{part(`${id}-end`, endLabel, endName, endValue)}
			{note !== "" && <p class="date-range-note form-hint">{note}</p>}
		</div>
	);
};
