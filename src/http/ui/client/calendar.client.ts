// Shuriken calendar page enhancement. Authored in TypeScript, bundled to
// /static/calendar.js at startup by ClientJsService, and loaded `defer` only on
// the calendar viewer.
//
// Responsibilities:
//   * Progressive enhancement of the import form (auto-submit on file pick;
//     no-JS users use the explicit Upload button).
//   * Live overlay toggling from the sidebar calendar checkboxes — add/remove a
//     FullCalendar event source per calendar (no-JS users use the Apply button).
//   * A beforeunload guard while a long import is in flight.
//   * Booting FullCalendar (reading config from #fullcalendar data-* attributes,
//     one event source per visible calendar), replacing the #cal-fallback list.
//   * Driving the event dialogs: seed + open the New-event dialog on a
//     calendar drag-select; load the Edit-event fragment on an event click; and
//     on a `shuriken:calendar-refresh` trigger (emitted by import/create/update/
//     delete) close any open dialog and refetch — or reload if FullCalendar is
//     not loaded.

// These ids MUST match src/http/ui/view/pages/calendar/event-popovers.tsx and
// the `new-` idPrefix on its EventFormBody (client code is self-contained, so
// the constants are duplicated rather than imported).
const NEW_POPOVER_ID = "new-event-popover";
const EDIT_POPOVER_ID = "edit-event-popover";
const EDIT_BODY_ID = "edit-event-popover-body";
// The shared Add-calendar / Feeds dialog (calendar/popover.tsx) — closed on the
// calendar-refresh event; opened natively via commandfor/command="show-modal".
const CALENDAR_POPOVER_ID = "calendar-popover";
// Read-only hover/click preview card — must match event-hover-card.tsx.
const HOVER_CARD_ID = "event-hover-card";
const HOVER_CARD_BODY_ID = "event-hover-card-body";

import rrulePlugin from "@fullcalendar/rrule";
import { Calendar, type EventSourceInput, joinClassNames } from "fullcalendar";
import dayGridPlugin from "fullcalendar/daygrid";
import interactionPlugin from "fullcalendar/interaction";
import listPlugin from "fullcalendar/list";
// Structural/layout CSS only — no colours, no theme (verified against the
// package source: zero `color:`/`url()`/`@font-face` declarations). Bundled
// to calendar.css by Deno.bundle() and served as a real stylesheet (see
// assets.tsx's CALENDAR_ASSETS), not injected at runtime — all colour/spacing
// theming instead comes from the class-name-prop options below.
import "fullcalendar/skeleton.css";
import timeGridPlugin from "fullcalendar/timegrid";

// One remote event feed — a calendar's JSON endpoint, tinted with its colour.
// `textColor` is server-computed (contrastTextColor, view/color-contrast.ts)
// so light/dark calendar colours stay readable; recomputing it here would
// require duplicating that logic into the client bundle. Kept as our own
// field name at the app boundary — mapped to FullCalendar's own
// `color`/`contrastColor` EventSourceInput fields in toFcEventSource below.
interface FcEventSourceInput {
	readonly id: string;
	readonly url: string;
	readonly color?: string;
	readonly textColor?: string;
}
const toFcEventSource = (input: FcEventSourceInput): EventSourceInput => ({
	id: input.id,
	url: input.url,
	color: input.color,
	contrastColor: input.textColor,
});

// ---------------------------------------------------------------------------
// Tailwind-native theming, adapted from FullCalendar's official "forma"
// Tailwind starter (github.com/fullcalendar/tailwind-starters/event-calendar)
// — every visible style comes from class-name-prop options, none from a
// packaged FullCalendar theme CSS. The starter is written for the React
// component API and Tailwind v4's `bg-(--x)` variable shorthand; translated
// here to the imperative Calendar API and Tailwind v3's `bg-[var(--x)]`
// arbitrary-value syntax (this repo pins tailwindcss@^3.4.17). Content hooks
// that return JSX (custom day-header markup, button icon SVGs) are skipped —
// FullCalendar's default text/markup is used instead. `--fc-forma-*` are our
// own design tokens (input.css); `--fc-event-color`/`--fc-event-contrast-color`
// are set by FullCalendar itself per event (see toFcEventSource below).
// ---------------------------------------------------------------------------

const FAINT_HOVER_CLASS = "hover:bg-[var(--fc-forma-muted)]";
const MUTED_HOVER_CLASS =
	"hover:bg-[var(--fc-forma-muted)] active:bg-[var(--fc-forma-strong)]";
const PRIMARY_CLASS =
	"bg-[var(--fc-forma-primary)] text-[var(--fc-forma-primary-foreground)]";
const PRIMARY_BUTTON_CLASS = `${PRIMARY_CLASS} hover:bg-[var(--fc-forma-primary-over)] active:bg-[var(--fc-forma-primary-down)] border border-transparent`;
const SECONDARY_BUTTON_CLASS = `${MUTED_HOVER_CLASS} border border-[var(--fc-forma-border)] hover:border-[var(--fc-forma-strong-border)]`;
const SELECTED_BUTTON_CLASS =
	"bg-[var(--fc-forma-muted)] border border-[var(--fc-forma-strong-border)]";
const UNSELECTED_BUTTON_CLASS = `${MUTED_HOVER_CLASS} border border-transparent`;

const toolbarClass = "p-3 flex flex-wrap items-center justify-between gap-3";
const toolbarSectionClass = "flex flex-wrap items-center gap-3";
const buttonGroupClass = "flex items-center";
const buttonClass = (info: {
	readonly isSelected: boolean;
	readonly isPrimary: boolean;
	readonly isDisabled: boolean;
	readonly isIconOnly: boolean;
	readonly buttonGroup?: { readonly hasSelection: boolean } | null;
}): string =>
	joinClassNames(
		"group py-1.5 rounded-sm flex items-center text-sm transition-colors",
		info.isIconOnly ? "px-2" : "px-3",
		info.isDisabled && "cursor-not-allowed opacity-50",
		info.isIconOnly
			? MUTED_HOVER_CLASS
			: info.buttonGroup?.hasSelection
				? info.isSelected
					? SELECTED_BUTTON_CLASS
					: UNSELECTED_BUTTON_CLASS
				: info.isPrimary
					? PRIMARY_BUTTON_CLASS
					: SECONDARY_BUTTON_CLASS,
	);

const dayHeaderClass = "text-[var(--fc-forma-foreground)] justify-center";
const dayCellClass = (info: { readonly isToday: boolean }): string =>
	joinClassNames(
		"border border-[var(--fc-forma-border)]",
		info.isToday && "bg-[var(--fc-forma-faint)]",
	);
const dayCellTopInnerClass = (info: { readonly isToday: boolean }): string =>
	joinClassNames(
		"flex items-center justify-center my-1 h-6 px-2 text-sm whitespace-nowrap",
		info.isToday && "rounded-e-sm font-bold ms-1",
		info.isToday && PRIMARY_CLASS,
	);

// FullCalendar sets `--fc-event-color`/`--fc-event-contrast-color` as inline
// custom properties on every event element (per calendar's server-computed
// colour), but never consumes them itself — normally that's a theme
// stylesheet's job. Tailwind's arbitrary-property syntax reads them directly.
//
// Month view (dayGridMonth) renders EVERY event — all-day or timed — as a
// "row event"; FullCalendar itself further splits row-event rendering into
// a plain dot-marker style for single-day events (confirmed from a rendered
// DOM dump: FullCalendar internally uses list-item-event markup/classes for
// the timed ones) and needs an explicit block/bar style for multi-day spans,
// via each day-segment's `isStart`/`isEnd` flags (both true only when the
// event's entire span is a single day). Sizing matches list view's dot
// exactly so both look uniform inside the same day cell.
const isSingleDaySegment = (info: {
	readonly isStart: boolean;
	readonly isEnd: boolean;
}): boolean => info.isStart && info.isEnd;

const DOT_CLASS =
	"shrink-0 self-center rounded-full border-4 [border-color:var(--fc-event-color)]";
const DOT_ROW_CLASS =
	"flex items-center rounded-sm p-2 gap-2 hover:bg-[var(--fc-forma-muted)]";
const DOT_ROW_INNER_CLASS = "flex items-center gap-2 text-sm overflow-hidden";

const rowEventClass = (info: {
	readonly isStart: boolean;
	readonly isEnd: boolean;
}): string =>
	isSingleDaySegment(info)
		? DOT_ROW_CLASS
		: joinClassNames(
				"rounded-sm p-2 overflow-hidden [background-color:var(--fc-event-color)] [color:var(--fc-event-contrast-color)]",
				info.isStart && "rounded-s-sm",
				info.isEnd && "rounded-e-sm",
			);
const rowEventBeforeClass = (info: {
	readonly isStart: boolean;
	readonly isEnd: boolean;
}): string => (isSingleDaySegment(info) ? DOT_CLASS : "");
const rowEventInnerClass = (info: {
	readonly isStart: boolean;
	readonly isEnd: boolean;
}): string => (isSingleDaySegment(info) ? DOT_ROW_INNER_CLASS : "text-sm");

const COLUMN_EVENT_CLASS =
	"rounded-sm border-s-4 [border-color:var(--fc-event-color)] [background-color:color-mix(in_oklab,var(--fc-event-color)_20%,var(--fc-forma-background))]";
const COLUMN_EVENT_INNER_CLASS = "flex flex-col px-1 text-xs";
// List view keeps the classic dot-marker look (colour on a small circle, not
// a tinted background block) rather than the block/column events' fill.
const LIST_ITEM_EVENT_CLASS = DOT_ROW_CLASS;
const LIST_ITEM_EVENT_BEFORE_CLASS = DOT_CLASS;
const MORE_LINK_CLASS = `mb-px border rounded-sm border-transparent ${MUTED_HOVER_CLASS}`;

const popoverClass =
	"border border-[var(--fc-forma-border)] bg-[var(--fc-forma-background)] text-[var(--fc-forma-foreground)] shadow-md min-w-55";
const popoverCloseClass = `absolute top-1 end-1 p-1 rounded-sm ${FAINT_HOVER_CLASS}`;

// --- HTMX global (used to load the edit fragment on FullCalendar clicks) ----
type HtmxAjax = (
	verb: string,
	path: string,
	options: { target: string; swap: string },
) => Promise<void>;
const getHtmx = (): { ajax: HtmxAjax } | undefined => {
	const h = (globalThis as Record<string, unknown>).htmx;
	return typeof h === "object" && h !== null && "ajax" in h
		? (h as { ajax: HtmxAjax })
		: undefined;
};

// --- Dialog helpers ----------------------------------------------------------
// Focus return to the invoker on close is automatic for <dialog>. Swallow the
// InvalidStateError thrown when the dialog is already open/closed.
const openDialog = (el: HTMLElement | null): void => {
	if (!(el instanceof HTMLDialogElement)) {
		return;
	}
	try {
		el.showModal();
	} catch {
		/* already open */
	}
};
const closeDialogById = (id: string): void => {
	const el = document.getElementById(id);
	if (el instanceof HTMLDialogElement) {
		try {
			el.close();
		} catch {
			/* not currently open */
		}
	}
};

// --- Hover card (read-only preview, shown on hover + click) -----------------
// A `popover="manual"` element — not a <dialog> — so it's non-modal and its
// show/hide is entirely driven from here (no light-dismiss), letting hover and
// click share the same logic. Positioned next to the trigger via
// getBoundingClientRect, clamped to the viewport.
const HOVER_OPEN_DELAY_MS = 300;
const HOVER_CLOSE_DELAY_MS = 200;
let hoverOpenTimer: number | undefined;
let hoverCloseTimer: number | undefined;
// Bumped on every open/click so a slow, superseded fetch never shows stale
// content after a newer hover/click already resolved.
let hoverCardToken = 0;

const clearHoverOpenTimer = (): void => {
	window.clearTimeout(hoverOpenTimer);
	hoverOpenTimer = undefined;
};
const clearHoverCloseTimer = (): void => {
	window.clearTimeout(hoverCloseTimer);
	hoverCloseTimer = undefined;
};

const positionHoverCard = (card: HTMLElement, anchor: Element): void => {
	const margin = 8;
	const anchorRect = anchor.getBoundingClientRect();
	const cardRect = card.getBoundingClientRect();
	let left = anchorRect.left;
	let top = anchorRect.bottom + margin;
	if (left + cardRect.width > window.innerWidth - margin) {
		left = Math.max(margin, window.innerWidth - cardRect.width - margin);
	}
	if (top + cardRect.height > window.innerHeight - margin) {
		top = Math.max(margin, anchorRect.top - cardRect.height - margin);
	}
	card.style.left = `${left}px`;
	card.style.top = `${top}px`;
};

const hideHoverCard = (): void => {
	clearHoverOpenTimer();
	clearHoverCloseTimer();
	const card = document.getElementById(HOVER_CARD_ID);
	if (card instanceof HTMLElement && typeof card.hidePopover === "function") {
		try {
			card.hidePopover();
		} catch {
			/* not currently open */
		}
	}
};

// Fetch + show immediately — used by click, and by the debounced hover open.
const showHoverCardNow = (url: string, anchor: Element): void => {
	clearHoverOpenTimer();
	clearHoverCloseTimer();
	const card = document.getElementById(HOVER_CARD_ID);
	const htmx = getHtmx();
	if (
		!(card instanceof HTMLElement) ||
		typeof card.showPopover !== "function" ||
		!htmx
	) {
		window.location.href = url;
		return;
	}
	const token = ++hoverCardToken;
	htmx
		.ajax("GET", url, { target: `#${HOVER_CARD_BODY_ID}`, swap: "innerHTML" })
		.then(() => {
			if (token !== hoverCardToken) {
				return;
			}
			try {
				card.showPopover();
			} catch {
				/* already open */
			}
			positionHoverCard(card, anchor);
		});
};

const scheduleHoverCardOpen = (url: string, anchor: Element): void => {
	clearHoverOpenTimer();
	clearHoverCloseTimer();
	hoverOpenTimer = window.setTimeout(
		() => showHoverCardNow(url, anchor),
		HOVER_OPEN_DELAY_MS,
	);
};

const scheduleHoverCardClose = (): void => {
	clearHoverOpenTimer();
	clearHoverCloseTimer();
	hoverCloseTimer = window.setTimeout(hideHoverCard, HOVER_CLOSE_DELAY_MS);
};

// Open the real Edit dialog for a hover-card's Edit button (or, absent htmx,
// fall back to navigating there) — the same logic eventClick used before the
// hover card took over the click gesture.
const openEditDialog = (url: string): void => {
	const htmx = getHtmx();
	if (!htmx) {
		window.location.href = url;
		return;
	}
	openDialog(document.getElementById(EDIT_POPOVER_ID));
	htmx.ajax("GET", url, { target: `#${EDIT_BODY_ID}`, swap: "innerHTML" });
};

(() => {
	// --- Long-op guard + control enhancement ---------------------------------
	let inFlight = 0;
	const guard = (e: BeforeUnloadEvent): string => {
		e.preventDefault();
		e.returnValue = "";
		return "";
	};
	const isLong = (t: EventTarget | null): boolean =>
		t instanceof Element && t.closest("[data-longop]") !== null;
	document.addEventListener("htmx:before:request", (e: Event) => {
		if (!isLong(e.target)) {
			return;
		}
		if (inFlight === 0) {
			window.addEventListener("beforeunload", guard);
		}
		inFlight++;
	});
	document.addEventListener("htmx:after:request", (e: Event) => {
		if (!isLong(e.target)) {
			return;
		}
		inFlight = Math.max(0, inFlight - 1);
		if (inFlight === 0) {
			window.removeEventListener("beforeunload", guard);
		}
	});

	// Export is a native download link — show a transient indicator (a download
	// never navigates the page, so no unload guard).
	const exportIndicatorMs = 8000;
	const exportLink = document.getElementById("cal-export");
	const exportIndicator = document.getElementById("cal-export-indicator");
	if (exportLink && exportIndicator) {
		exportLink.addEventListener("click", () => {
			exportIndicator.classList.add("is-busy");
			setTimeout(() => {
				exportIndicator.classList.remove("is-busy");
			}, exportIndicatorMs);
		});
	}

	// Auto-submit the import form on file pick (no-JS users use Upload instead).
	const importFile = document.getElementById("cal-import-file");
	if (importFile instanceof HTMLInputElement && importFile.form) {
		importFile.addEventListener("change", () => {
			importFile.form?.requestSubmit();
		});
	}

	// --- Event popovers ------------------------------------------------------
	// Keep a reference so the refresh handler can refetch; null until (and
	// unless) FullCalendar boots.
	let calendar: Calendar | null = null;

	const setInputValue = (id: string, value: string): void => {
		const el = document.getElementById(id);
		if (el instanceof HTMLInputElement) {
			el.value = value;
		}
	};
	const setChecked = (id: string, checked: boolean): void => {
		const el = document.getElementById(id);
		if (el instanceof HTMLInputElement) {
			el.checked = checked;
		}
	};

	// Inline dialogs (New event, Add calendar → Create) open natively via
	// `commandfor`/`command="show-modal"`. Lazily-loaded dialogs (Feeds,
	// Subscribe) use a real link (no-JS follows it to a full page); with JS,
	// htmx loads the fragment and we open the dialog here.
	document.addEventListener("click", (e: Event) => {
		const el = e.target;
		if (!(el instanceof Element)) {
			return;
		}
		const trigger = el.closest("[data-popover]");
		if (trigger instanceof HTMLElement && trigger.dataset.popover) {
			openDialog(document.getElementById(trigger.dataset.popover));
			return;
		}
		// The hover card's Edit button — a real link to the full edit page (no-JS
		// fallback); with JS, hide the hover card and open the real edit dialog
		// instead of navigating.
		const editTrigger = el.closest("[data-edit-event]");
		if (editTrigger instanceof HTMLAnchorElement) {
			e.preventDefault();
			hideHoverCard();
			openEditDialog(editTrigger.href);
			return;
		}
		// Sidebar "upcoming events" rows — a real link to the full edit page
		// (no-JS fallback, and shared-events rows with no edit route); with JS,
		// jump straight to the edit dialog instead of navigating away — but only
		// when the row is actually editable (`data-editable`); a free-busy-only
		// or otherwise non-full-read row has no edit route to open (it would
		// 403), so it shows the read-only preview card instead, same as hover.
		const previewTrigger = el.closest("[data-hover-preview]");
		if (
			previewTrigger instanceof HTMLAnchorElement &&
			previewTrigger.dataset.hoverPreview
		) {
			e.preventDefault();
			if (previewTrigger.dataset.editable) {
				hideHoverCard();
				openEditDialog(previewTrigger.href);
			} else {
				showHoverCardNow(previewTrigger.dataset.hoverPreview, previewTrigger);
			}
		}
	});

	// Hover-preview triggers outside FullCalendar (the sidebar "upcoming
	// events" list) — mouseover/mouseout (not mouseenter/mouseleave, which
	// don't bubble) delegated + relatedTarget-checked so re-entering the same
	// trigger doesn't re-fire.
	document.addEventListener("mouseover", (e: Event) => {
		if (!(e instanceof MouseEvent) || !(e.target instanceof Element)) {
			return;
		}
		const trigger = e.target.closest("[data-hover-preview]");
		if (!(trigger instanceof HTMLElement) || !trigger.dataset.hoverPreview) {
			return;
		}
		if (e.relatedTarget instanceof Node && trigger.contains(e.relatedTarget)) {
			return;
		}
		scheduleHoverCardOpen(trigger.dataset.hoverPreview, trigger);
	});
	document.addEventListener("mouseout", (e: Event) => {
		if (!(e instanceof MouseEvent) || !(e.target instanceof Element)) {
			return;
		}
		const trigger = e.target.closest("[data-hover-preview]");
		if (!(trigger instanceof HTMLElement)) {
			return;
		}
		if (e.relatedTarget instanceof Node && trigger.contains(e.relatedTarget)) {
			return;
		}
		scheduleHoverCardClose();
	});

	// Keep the card open while the pointer is over it (so the Edit button is
	// reachable), and let it close once the pointer leaves it.
	const hoverCardEl = document.getElementById(HOVER_CARD_ID);
	hoverCardEl?.addEventListener("mouseenter", clearHoverCloseTimer);
	hoverCardEl?.addEventListener("mouseleave", scheduleHoverCardClose);

	// Close dialogs + refetch when a write reports success (import/create/
	// update/delete all emit this). Reload as a fallback when the interactive
	// calendar isn't loaded, so the server-rendered list reflects the change.
	document.body.addEventListener("shuriken:calendar-refresh", () => {
		closeDialogById(NEW_POPOVER_ID);
		closeDialogById(EDIT_POPOVER_ID);
		closeDialogById(CALENDAR_POPOVER_ID);
		hideHoverCard();
		const newForm = document.querySelector(`#${NEW_POPOVER_ID} form`);
		if (newForm instanceof HTMLFormElement) {
			newForm.reset();
		}
		if (calendar) {
			calendar.refetchEvents();
		} else {
			window.location.reload();
		}
	});

	// --- Calendar list overlay + active switching ----------------------------
	// Each `[data-cal-toggle]` checkbox shows/hides that calendar's events; each
	// `[data-cal-switch]` name link makes that calendar the ACTIVE one (target of
	// new/import/export). With FullCalendar loaded both are handled live — add or
	// remove the event source, rewrite the action targets + highlight, and keep
	// the visibility-carrying links (`[data-cal-nav]`) and page URL in sync so a
	// reload restores the same view. Falls back to plain navigation / a form
	// submit only when FullCalendar never loaded.

	// The active calendar id — seeded from #fullcalendar on boot, updated live by
	// setActive so the toggle/switch handlers can consult it.
	let activeId = "";

	const toggles = (): ReadonlyArray<HTMLInputElement> =>
		Array.from(document.querySelectorAll("[data-cal-toggle]")).filter(
			(el): el is HTMLInputElement => el instanceof HTMLInputElement,
		);
	const checkedCalIds = (): ReadonlyArray<string> =>
		toggles()
			.filter((t) => t.checked)
			.map((t) => t.dataset.calId ?? "")
			.filter((id) => id !== "");
	const toggleFor = (id: string): HTMLInputElement | null => {
		const el = document.querySelector(`[data-cal-toggle][data-cal-id="${id}"]`);
		return el instanceof HTMLInputElement ? el : null;
	};

	// Point a form at a calendar (rewriting the htmx attribute too, when present).
	const retargetForm = (form: Element | null | undefined, action: string) => {
		if (!(form instanceof HTMLFormElement)) {
			return;
		}
		form.setAttribute("action", action);
		if (form.hasAttribute("hx-post")) {
			form.setAttribute("hx-post", action);
		}
	};

	// Make `id` the active calendar: repoint new/import/export at it and move the
	// sidebar highlight. Does NOT change visibility (callers ensure it's shown).
	const setActive = (id: string): void => {
		activeId = id;
		retargetForm(
			document.querySelector(`#${NEW_POPOVER_ID} form`),
			`/ui/api/calendar/${id}/events/create`,
		);
		retargetForm(
			document.getElementById("cal-import-file")?.closest("form"),
			`/ui/api/calendar/${id}/import`,
		);
		const exportLink = document.getElementById("cal-export");
		if (exportLink instanceof HTMLAnchorElement) {
			exportLink.href = `/ui/calendar/${id}/export.ics`;
		}
		const fc = document.getElementById("fullcalendar");
		if (fc) {
			fc.dataset.active = id;
		}
		for (const link of Array.from(
			document.querySelectorAll("[data-cal-switch]"),
		)) {
			if (!(link instanceof HTMLElement)) {
				continue;
			}
			const on = link.dataset.switchId === id;
			const row = link.closest("li");
			row?.classList.toggle("bg-surface-2", on);
			row?.classList.toggle("hover:bg-surface-2", !on);
			const name = link.querySelector("[data-cal-name]");
			name?.classList.toggle("font-semibold", on);
			name?.classList.toggle("text-fg", on);
			name?.classList.toggle("text-muted", !on);
			if (on) {
				link.setAttribute("aria-current", "true");
			} else {
				link.removeAttribute("aria-current");
			}
		}
	};

	// Rewrite every visibility-carrying link's `cal` params to the current set
	// (leaving its own `collection`/`month` intact), and the page URL's `cal` +
	// active `collection`, so a reload restores exactly what's on screen.
	const syncLinks = (): void => {
		const ids = checkedCalIds();
		for (const link of Array.from(
			document.querySelectorAll("a[data-cal-nav]"),
		)) {
			if (!(link instanceof HTMLAnchorElement)) {
				continue;
			}
			const url = new URL(link.href, window.location.origin);
			url.searchParams.delete("cal");
			for (const id of ids) {
				url.searchParams.append("cal", id);
			}
			url.searchParams.set("cals", "1");
			link.href = url.pathname + url.search;
		}
		const here = new URL(window.location.href);
		here.searchParams.delete("cal");
		for (const id of ids) {
			here.searchParams.append("cal", id);
		}
		here.searchParams.set("cals", "1");
		if (activeId !== "") {
			here.searchParams.set("collection", activeId);
		}
		window.history.replaceState(null, "", here.pathname + here.search);
	};

	// --- FullCalendar boot ---------------------------------------------------
	document.addEventListener("DOMContentLoaded", () => {
		const el = document.getElementById("fullcalendar");
		if (!el) {
			return;
		}
		const fallback = document.getElementById("cal-fallback");
		activeId = el.dataset.active ?? "";

		// Initial event sources — one JSON feed per visible calendar, each tinted.
		let sources: ReadonlyArray<FcEventSourceInput> = [];
		try {
			const parsed = JSON.parse(el.dataset.sources ?? "[]");
			if (Array.isArray(parsed)) {
				sources = parsed as ReadonlyArray<FcEventSourceInput>;
			}
		} catch {
			/* malformed data-sources → start with no feeds */
		}

		// Fill the viewport on lg+ (the shell is height-locked there); flow at
		// natural height on small screens where the page scrolls normally.
		const fillsViewport = (): boolean =>
			window.matchMedia("(min-width: 1024px)").matches;
		const isMobile = (): boolean =>
			window.matchMedia("(max-width: 767px)").matches;
		const mobileToolbar = {
			left: "prev,next",
			center: "title",
			right: "today listWeek,timeGridDay",
		};
		const desktopToolbar = {
			left: "prev,next today",
			center: "title",
			right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
		};
		const initialMobile = isMobile();

		calendar = new Calendar(el, {
			plugins: [
				dayGridPlugin,
				timeGridPlugin,
				listPlugin,
				interactionPlugin,
				rrulePlugin,
			],
			initialView: initialMobile ? "listWeek" : "dayGridMonth",
			initialDate: el.dataset.initialDate || undefined,
			height: fillsViewport() ? "100%" : "auto",
			headerToolbar: initialMobile ? mobileToolbar : desktopToolbar,
			selectable: true,
			editable: false,
			nowIndicator: true,
			eventSources: sources.map(toFcEventSource),
			eventShortHeight: 50,
			// Tailwind-native theming, adapted from FullCalendar's forma starter
			// (see the block of constants above) — replaces the old --fc-*
			// CSS-variable overrides that used to live in input.css.
			toolbarClass,
			toolbarSectionClass,
			toolbarTitleClass: "text-xl",
			buttonGroupClass,
			buttonClass,
			dayHeaderClass,
			dayCellClass,
			dayCellTopInnerClass,
			dayRowClass: "border border-[var(--fc-forma-border)]",
			dayHeaderRowClass: "border border-[var(--fc-forma-border)]",
			slotHeaderRowClass: "border border-[var(--fc-forma-border)]",
			slotHeaderClass: "border border-[var(--fc-forma-border)] justify-end",
			slotHeaderInnerClass: "m-2 text-xs",
			slotLaneClass: "border border-[var(--fc-forma-border)]",
			dayLaneClass: "border border-[var(--fc-forma-border)]",
			allDayHeaderClass: "items-center justify-end",
			allDayHeaderInnerClass: "m-2 text-end text-xs",
			allDayDividerClass: "border-b border-[var(--fc-forma-border)]",
			tableHeaderClass: "bg-[var(--fc-forma-background)]",
			fillerClass: "border border-[var(--fc-forma-border)] opacity-50",
			highlightClass: "bg-[var(--fc-forma-highlight)]",
			nowIndicatorLineClass: "border border-[var(--fc-forma-primary)]",
			nowIndicatorDotClass:
				"border-4 border-[var(--fc-forma-primary)] rounded-full bg-[var(--fc-forma-background)]",
			eventColor: "var(--fc-forma-event)",
			eventContrastColor: "var(--fc-forma-event-contrast)",
			// Root-level, not nested under `views` — row events only occur in
			// month view's day cells and timeGrid's all-day strip (which we
			// don't populate), so this doesn't reach week/day's timed events
			// (those are "column" events, styled separately below).
			rowEventClass,
			rowEventBeforeClass,
			rowEventInnerClass,
			columnEventClass: COLUMN_EVENT_CLASS,
			columnEventInnerClass: COLUMN_EVENT_INNER_CLASS,
			moreLinkClass: MORE_LINK_CLASS,
			moreLinkInnerClass:
				"whitespace-nowrap overflow-hidden text-xs px-1 py-0.5",
			popoverClass,
			popoverCloseClass,
			listDayClass: "flex items-start border-b border-[var(--fc-forma-border)]",
			listDayHeaderClass:
				"shrink-0 w-1/4 max-w-40 p-3 flex flex-col items-start",
			listDayHeaderInnerClass: "my-0.5",
			listDayBodyClass: "grow min-w-0 p-4",
			listItemEventClass: LIST_ITEM_EVENT_CLASS,
			listItemEventBeforeClass: LIST_ITEM_EVENT_BEFORE_CLASS,
			listItemEventInnerClass: "flex items-center gap-2 text-sm",
			listItemEventTitleClass:
				"font-semibold whitespace-nowrap overflow-hidden",
			listItemEventTimeClass: "whitespace-nowrap overflow-hidden text-muted",
			// Seed the New-event dialog's date fields from the drag-selection, then
			// open it (mirrors the no-JS button's command="show-modal" path).
			select: (info) => {
				setInputValue("new-start", info.startStr);
				setInputValue("new-end", info.endStr);
				setChecked("new-allDay", info.allDay);
				openDialog(document.getElementById(NEW_POPOVER_ID));
			},
			// Hover shows the read-only preview card; click jumps straight to the
			// real edit dialog (see openEditDialog above). The event's own calendar
			// (its source id) owns the URL.
			eventMouseEnter: (info) => {
				const collectionId = info.event.source?.id ?? el.dataset.active ?? "";
				const url = `/ui/calendar/${collectionId}/events/${info.event.id}/preview`;
				scheduleHoverCardOpen(url, info.el);
			},
			eventMouseLeave: () => {
				scheduleHoverCardClose();
			},
			// A free-busy-only (or otherwise non-full-read) event has no edit
			// route to open (it would 403) — click falls back to showing the
			// same read-only preview card hover would, instead of opening a
			// dialog that immediately breaks.
			eventClick: (info) => {
				const collectionId = info.event.source?.id ?? el.dataset.active ?? "";
				if (info.event.extendedProps.readable === false) {
					const url = `/ui/calendar/${collectionId}/events/${info.event.id}/preview`;
					showHoverCardNow(url, info.el);
					return;
				}
				hideHoverCard();
				openEditDialog(`/ui/calendar/${collectionId}/events/${info.event.id}`);
			},
		});

		el.hidden = false;
		if (fallback) {
			fallback.hidden = true;
		}
		calendar.render();

		// Keep the height mode in step when crossing the lg breakpoint.
		window.addEventListener("resize", () => {
			const cal = calendar;
			if (!cal) {
				return;
			}
			cal.setOption("height", fillsViewport() ? "100%" : "auto");
			const mobile = isMobile();
			cal.setOption("headerToolbar", mobile ? mobileToolbar : desktopToolbar);
			if (mobile && cal.view.type === "dayGridMonth") {
				cal.changeView("listWeek");
			}
			if (!mobile && cal.view.type === "listWeek") {
				cal.changeView("dayGridMonth");
			}
		});
	});

	// Wire the sidebar calendar list. Always attached (the no-JS Apply button and
	// link navigation are hidden/replaced once JS runs). When FullCalendar is
	// loaded, visibility toggles add/remove event sources and name clicks switch
	// the active calendar — all live; otherwise we fall back to a form submit /
	// plain navigation so the server re-renders.
	document.addEventListener("DOMContentLoaded", () => {
		// Visibility checkboxes.
		for (const toggle of toggles()) {
			toggle.addEventListener("change", () => {
				const cal = calendar;
				if (!cal) {
					toggle.form?.requestSubmit();
					return;
				}
				const id = toggle.dataset.calId ?? "";
				if (toggle.checked) {
					cal.addEventSource(
						toFcEventSource({
							id,
							url: toggle.dataset.calUrl ?? "",
							color: toggle.dataset.calColor || undefined,
							textColor: toggle.dataset.calTextColor || undefined,
						}),
					);
				} else {
					cal.getEventSourceById(id)?.remove();
					// Hiding the active calendar hands "active" to the first calendar
					// still shown (mirrors the server). If none remain, it stays active
					// but hidden — new/import/export still have a target.
					if (id === activeId) {
						const next = checkedCalIds()[0];
						if (next !== undefined) {
							setActive(next);
						}
					}
				}
				syncLinks();
			});
		}

		// Calendar name links — switch the active calendar (and ensure it's shown).
		for (const link of Array.from(
			document.querySelectorAll("[data-cal-switch]"),
		)) {
			link.addEventListener("click", (e) => {
				const cal = calendar;
				if (!cal || !(link instanceof HTMLElement)) {
					return; // no interactive calendar → let the link navigate
				}
				e.preventDefault();
				const id = link.dataset.switchId ?? "";
				if (id === "") {
					return;
				}
				const toggle = toggleFor(id);
				if (toggle && !toggle.checked) {
					toggle.checked = true;
					cal.addEventSource(
						toFcEventSource({
							id,
							url: toggle.dataset.calUrl ?? "",
							color: toggle.dataset.calColor || undefined,
							textColor: toggle.dataset.calTextColor || undefined,
						}),
					);
				}
				setActive(id);
				syncLinks();
			});
		}
	});
})();
