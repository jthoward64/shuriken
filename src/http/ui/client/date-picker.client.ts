import { initDatePickers } from "./controls/date-picker.ts";

// ---------------------------------------------------------------------------
// Date-control bundle - progressive enhancement for DateField/DateRangeField
// (see view/components/controls/date-picker.tsx). Kept out of forms.js because
// it is the only control that needs the Temporal polyfill, which dominates the
// bundle: pages without a date field never download it.
//
// Both controls degrade to a native date input, so this script is optional;
// nothing here is required for a form to submit correct data.
//
// Initialization runs again after each HTMX swap, since a swapped-in fragment
// can carry controls that were not in the document at load. The control keeps
// a WeakSet of what it has already wired, so re-running is idempotent.
// ---------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", initDatePickers);
document.addEventListener("htmx:afterSettle", initDatePickers);
