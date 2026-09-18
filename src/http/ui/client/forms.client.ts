import { initRichText } from "./controls/rich-text.ts";
import { initSearchPickers } from "./controls/search-picker.ts";
import { initTagComboboxes } from "./controls/tag-combobox.ts";
import { initTagPickers } from "./controls/tag-picker.ts";

// ---------------------------------------------------------------------------
// Form-control bundle - progressive enhancement for the scripted controls
// (see view/tag-picker.tsx, search-picker.tsx, rich-text.tsx). Served as
// /static/forms.js and loaded by pages that use them. The date controls ship
// separately as /static/date-picker.js, which carries the Temporal polyfill.
//
// Every control degrades to a working native input, so this script is
// optional: nothing here is required for a form to submit correct data.
//
// Initialization runs again after each HTMX swap, since a swapped-in fragment
// can carry controls that were not in the document at load. Each control keeps
// a WeakSet of what it has already wired, so re-running is idempotent.
// ---------------------------------------------------------------------------

const initControls = (): void => {
	initTagPickers();
	initTagComboboxes();
	initSearchPickers();
	initRichText();
};

document.addEventListener("DOMContentLoaded", initControls);
document.addEventListener("htmx:afterSettle", initControls);
