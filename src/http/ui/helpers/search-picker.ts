import { encodeJson } from "#src/http/ui/helpers/json.ts";
// ---------------------------------------------------------------------------
// SearchPicker wire contract - shared by the control (view/search-picker.tsx),
// its browser script, and any endpoint that feeds one.
//
// Lives outside the view module so a handler can be typed against the response
// shape without importing JSX.
// ---------------------------------------------------------------------------

export interface SearchPickerItem {
	/** Submitted as the field's value when chosen. */
	readonly value: string;
	/** Primary line shown in the results list. */
	readonly label: string;
	/** Secondary line, e.g. an email address disambiguating two same-named people. */
	readonly description?: string;
}

export interface SearchPickerResponse {
	readonly items: ReadonlyArray<SearchPickerItem>;
	/** Set when results were capped, so the list can say so. */
	readonly truncated?: boolean;
}

/** JSON response in the shape the SearchPicker script expects */
export const searchPickerResponse = (
	items: ReadonlyArray<SearchPickerItem>,
	truncated = false,
): Response =>
	new Response(
		encodeJson({ items, truncated } satisfies SearchPickerResponse),
		{
			headers: { "Content-Type": "application/json; charset=utf-8" },
		},
	);
