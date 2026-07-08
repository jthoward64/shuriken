// Boot script for the public, read-only /embed/<token> calendar widget.
// Bundled to /static/embed-widget.js by ClientJsService. Deliberately
// separate from calendar.client.ts, which assumes an authenticated, writable
// calendar (create/edit popovers, sidebar toggles, import) — none of that
// applies to a public, no-login widget. This script only renders events.

import rrulePlugin from "@fullcalendar/rrule";
import { Calendar, joinClassNames } from "fullcalendar";
import dayGridPlugin from "fullcalendar/daygrid";
import listPlugin from "fullcalendar/list";
// Structural/layout CSS only — see calendar.client.ts for why.
import "fullcalendar/skeleton.css";
import timeGridPlugin from "fullcalendar/timegrid";

// Tailwind-native theming, matching calendar.client.ts's minimal subset (see
// there for the full explanation and the --fc-forma-* token definitions in
// input.css) — a public, unauthenticated widget only needs to look sane
// against an arbitrary host page background, not the full app chrome.
const MUTED_HOVER_CLASS =
	"hover:bg-[var(--fc-forma-muted)] active:bg-[var(--fc-forma-strong)]";
const buttonClass = (info: { readonly isDisabled: boolean }): string =>
	joinClassNames(
		"py-1.5 px-3 rounded-sm text-sm border border-[var(--fc-forma-border)] transition-colors",
		info.isDisabled
			? "cursor-not-allowed opacity-50"
			: `hover:border-[var(--fc-forma-strong-border)] ${MUTED_HOVER_CLASS}`,
	);
const dayCellClass = (info: { readonly isToday: boolean }): string =>
	joinClassNames(
		"border border-[var(--fc-forma-border)]",
		info.isToday && "bg-[var(--fc-forma-faint)]",
	);
const dayCellTopInnerClass = (info: { readonly isToday: boolean }): string =>
	joinClassNames(
		"flex items-center justify-center my-1 h-6 px-2 text-sm whitespace-nowrap",
		info.isToday &&
			"rounded-e-sm font-bold ms-1 bg-[var(--fc-forma-primary)] text-[var(--fc-forma-primary-foreground)]",
	);

const BLOCK_EVENT_CLASS =
	"rounded-sm overflow-hidden [background-color:color-mix(in_oklab,var(--fc-event-color)_30%,var(--fc-forma-background))]";
const BLOCK_EVENT_INNER_CLASS =
	"px-1 py-0.5 text-xs whitespace-nowrap overflow-hidden";
const LIST_ITEM_EVENT_CLASS =
	"border-s-4 pl-2 rounded-sm [border-color:var(--fc-event-color)] [background-color:color-mix(in_oklab,var(--fc-event-color)_15%,transparent)] hover:[background-color:color-mix(in_oklab,var(--fc-event-color)_25%,transparent)]";

document.addEventListener("DOMContentLoaded", () => {
	const el = document.getElementById("fullcalendar-embed");
	if (!el) {
		return;
	}
	new Calendar(el, {
		plugins: [dayGridPlugin, timeGridPlugin, listPlugin, rrulePlugin],
		initialView: el.dataset.initialView || "dayGridMonth",
		height: "auto",
		headerToolbar: { left: "prev,next today", center: "title", right: "" },
		selectable: false,
		editable: false,
		events: el.dataset.eventsUrl ?? "",
		eventColor: "var(--fc-forma-event)",
		eventContrastColor: "var(--fc-forma-event-contrast)",
		toolbarClass: "p-3 flex flex-wrap items-center justify-between gap-3",
		toolbarSectionClass: "flex flex-wrap items-center gap-3",
		toolbarTitleClass: "text-xl",
		buttonGroupClass: "flex items-center",
		buttonClass,
		dayHeaderClass: "text-[var(--fc-forma-foreground)] justify-center",
		dayCellClass,
		dayCellTopInnerClass,
		dayRowClass: "border border-[var(--fc-forma-border)]",
		dayHeaderRowClass: "border border-[var(--fc-forma-border)]",
		blockEventClass: BLOCK_EVENT_CLASS,
		blockEventInnerClass: BLOCK_EVENT_INNER_CLASS,
		listDayClass: "flex items-start border-b border-[var(--fc-forma-border)]",
		listDayHeaderClass: "shrink-0 w-1/4 max-w-40 p-3 flex flex-col items-start",
		listItemEventClass: LIST_ITEM_EVENT_CLASS,
		listItemEventInnerClass: "gap-2 text-sm",
		listItemEventTitleClass: "font-semibold whitespace-nowrap overflow-hidden",
	}).render();
});
