import { Temporal } from "temporal-polyfill";
import { all, initAll, make, one, placeUnder } from "./dom.ts";

// ---------------------------------------------------------------------------
// DateField / DateRangeField enhancement (see view/date-picker.tsx).
//
// Replaces the native picker with a calendar popover: one month for a single
// date, two months plus quick presets for a range. The native <input> is left
// in place and keeps holding the value in its own format, so clearing the
// script (or a failed bundle load) leaves a working native control behind.
//
// All date arithmetic goes through Temporal rather than Date, matching the
// rest of the codebase; month lengths and end-of-month clamping in the preset
// ranges are the parts that actually need it.
// ---------------------------------------------------------------------------

const seen = new WeakSet<Element>();

const DAYS_IN_WEEK = 7;
/** Six weeks covers every possible month layout, so the grid never reflows */
const WEEKS_SHOWN = 6;
const GRID_CELLS = DAYS_IN_WEEK * WEEKS_SHOWN;
/** Length of an "HH:mm" prefix. */
const TIME_LENGTH = 5;
const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "17:00";
/** A known Monday, the origin for reading weekday names out of the locale. */
const REFERENCE_MONDAY = Temporal.PlainDate.from("2024-01-01");

const PRESET_LABELS: Record<string, string> = {
	today: "Today",
	yesterday: "Yesterday",
	"last-7-days": "Last 7 days",
	"last-30-days": "Last 30 days",
	"this-month": "This month",
	"last-month": "Last month",
	"this-year": "This year",
};

interface DateRange {
	readonly start: Temporal.PlainDate;
	readonly end: Temporal.PlainDate;
}

const presetRange = (
	preset: string,
	today: Temporal.PlainDate,
): DateRange | null => {
	switch (preset) {
		case "today":
			return { start: today, end: today };
		case "yesterday": {
			const d = today.subtract({ days: 1 });
			return { start: d, end: d };
		}
		case "last-7-days":
			return { start: today.subtract({ days: 6 }), end: today };
		case "last-30-days":
			return { start: today.subtract({ days: 29 }), end: today };
		case "this-month":
			return {
				start: today.with({ day: 1 }),
				end: today.with({ day: today.daysInMonth }),
			};
		case "last-month": {
			const prev = today.with({ day: 1 }).subtract({ months: 1 });
			return { start: prev, end: prev.with({ day: prev.daysInMonth }) };
		}
		case "this-year":
			return {
				start: today.with({ month: 1, day: 1 }),
				end: today.with({ month: 12, day: 31 }),
			};
		default:
			return null;
	}
};

// The browser's zone, deliberately: entered times are stored as floating values
// (no TZID, no Z), which mean the same clock time wherever they are read. "Today"
// and the presets therefore belong to the reader's own wall clock, so resolving
// them locally is what keeps the picker consistent with what gets stored.
const todayLocal = (): Temporal.PlainDate => Temporal.Now.plainDateISO();

/** Splits an input's value into its date and time halves, either of which may be absent */
const splitValue = (
	value: string,
): { date: Temporal.PlainDate | null; time: string } => {
	const [datePart = "", timePart = ""] = value.split("T");
	try {
		return {
			date: datePart === "" ? null : Temporal.PlainDate.from(datePart),
			time: timePart.slice(0, TIME_LENGTH),
		};
	} catch {
		return { date: null, time: "" };
	}
};

// Monday-first weekday names, taken from the browser's locale rather than
// hardcoded, by walking a week forward from a known Monday
const weekdayLabels = (): ReadonlyArray<string> =>
	Array.from({ length: DAYS_IN_WEEK }, (_, i) =>
		REFERENCE_MONDAY.add({ days: i }).toLocaleString(undefined, {
			weekday: "short",
		}),
	);

/**
 * Formats a year and month for the calendar heading.
 *
 * Goes through PlainDate rather than calling PlainYearMonth.toLocaleString: a
 * year-month only means something within its own calendar, so that method
 * throws "Mismatched calendars" whenever the locale resolves to a different
 * calendar than the object's (iso8601 here, gregory for most locales).
 * PlainDate is exempt while its calendar is iso8601, so formatting day 1
 * produces the same text without throwing.
 *
 * Exported for the regression test covering exactly that.
 */
export const monthName = (ym: Temporal.PlainYearMonth): string =>
	ym
		.toPlainDate({ day: 1 })
		.toLocaleString(undefined, { month: "long", year: "numeric" });

/** The 42 cells of a month grid, padded into whole Monday-start weeks */
const monthCells = (
	month: Temporal.PlainYearMonth,
): ReadonlyArray<Temporal.PlainDate> => {
	const first = month.toPlainDate({ day: 1 });
	// Temporal counts Monday as 1, so shifting by one lands Monday on column 0
	const lead = (first.dayOfWeek - 1) % DAYS_IN_WEEK;
	const origin = first.subtract({ days: lead });
	return Array.from({ length: GRID_CELLS }, (_, i) => origin.add({ days: i }));
};

interface FieldRefs {
	readonly input: HTMLInputElement;
	readonly trigger: HTMLButtonElement | null;
}

const fieldRefs = (wrapper: Element): FieldRefs | null => {
	const input = one<HTMLInputElement>(wrapper, "[data-date-input]");
	if (!input) {
		return null;
	}
	return {
		input,
		trigger: one<HTMLButtonElement>(wrapper, "[data-date-trigger]"),
	};
};

interface PickerOptions {
	readonly mode: "date" | "datetime";
	readonly presets: ReadonlyArray<string>;
	/** Floating-time note, taken from the markup so the wording lives in one place. */
	readonly zoneNote: string;
	readonly start: FieldRefs;
	/** Present for a range; absent for a single date. */
	readonly end: FieldRefs | null;
}

/** The range presets column, or null when there is nothing to show */
const buildPresetColumn = (
	presets: ReadonlyArray<string>,
): HTMLElement | null => {
	const labelled = presets.flatMap((p) => {
		const label = PRESET_LABELS[p];
		return label === undefined ? [] : [{ preset: p, label }];
	});
	if (labelled.length === 0) {
		return null;
	}
	const col = make("div", { class: "datepicker-presets" });
	for (const { preset, label } of labelled) {
		col.append(
			make(
				"button",
				{ type: "button", class: "datepicker-preset", "data-preset": preset },
				label,
			),
		);
	}
	return col;
};

/** Labelled time inputs for a datetime picker, or null for a date-only one */
const buildTimeRow = (
	withTime: boolean,
	isRange: boolean,
): {
	readonly row: HTMLElement;
	readonly startTime: HTMLInputElement;
	readonly endTime: HTMLInputElement | null;
} | null => {
	if (!withTime) {
		return null;
	}
	const row = make("div", { class: "datepicker-time" });
	const startTime = make("input", { type: "time", class: "form-input" });
	const startLabel = make(
		"label",
		{ class: "datepicker-time-label" },
		isRange ? "Start time" : "Time",
	);
	startLabel.append(startTime);
	row.append(startLabel);
	if (!isRange) {
		return { row, startTime, endTime: null };
	}
	const endTime = make("input", { type: "time", class: "form-input" });
	const endLabel = make(
		"label",
		{ class: "datepicker-time-label" },
		"End time",
	);
	endLabel.append(endTime);
	row.append(endLabel);
	return { row, startTime, endTime };
};

const buildPicker = (opts: PickerOptions): void => {
	const { mode, presets, zoneNote, start, end } = opts;
	const isRange = end !== null;
	const months = isRange ? 2 : 1;

	const panel = make("div", { class: "datepicker", popover: "auto" });
	const presetCol = buildPresetColumn(isRange ? presets : []);
	if (presetCol) {
		panel.append(presetCol);
	}

	const body = make("div", { class: "datepicker-body" });
	const nav = make("div", { class: "datepicker-nav" });
	const prev = make(
		"button",
		{
			type: "button",
			class: "datepicker-nav-btn",
			"aria-label": "Previous month",
		},
		"‹",
	);
	const next = make(
		"button",
		{ type: "button", class: "datepicker-nav-btn", "aria-label": "Next month" },
		"›",
	);
	const title = make("span", {
		class: "datepicker-title",
		"aria-live": "polite",
	});
	nav.append(prev, title, next);
	body.append(nav);

	const grids = make("div", { class: "datepicker-months" });
	const monthEls = Array.from({ length: months }, () => {
		const wrap = make("div", { class: "datepicker-month" });
		const grid = make("div", { class: "datepicker-grid", role: "grid" });
		wrap.append(grid);
		grids.append(wrap);
		return grid;
	});
	body.append(grids);

	const times = buildTimeRow(mode === "datetime", isRange);
	const startTime = times?.startTime ?? null;
	const endTime = times?.endTime ?? null;
	if (times) {
		body.append(times.row);
		// The field states this too, but the popover is where the time is
		// actually set, so it says so at the point of entry
		if (zoneNote !== "") {
			body.append(make("p", { class: "datepicker-zone-note" }, zoneNote));
		}
	}

	// No Apply button: every change writes straight through to the input, so a
	// confirm step would only stand between the person and the time fields
	const actions = make("div", { class: "datepicker-actions" });
	const clearBtn = make(
		"button",
		{ type: "button", class: "btn btn-ghost btn-sm" },
		"Clear",
	);
	actions.append(clearBtn);
	body.append(actions);
	panel.append(body);
	document.body.append(panel);

	const initial = splitValue(start.input.value);
	let selStart = initial.date;
	let selEnd = isRange ? splitValue(end.input.value).date : null;
	let view = (selStart ?? todayLocal()).toPlainYearMonth();
	// A second click completes the range; the first restarts it
	let awaitingEnd = false;

	const limit = (attr: "min" | "max"): Temporal.PlainDate | null =>
		splitValue(start.input.getAttribute(attr) ?? "").date;
	const min = limit("min");
	const max = limit("max");

	const inRange = (d: Temporal.PlainDate): boolean =>
		selStart !== null &&
		selEnd !== null &&
		Temporal.PlainDate.compare(d, selStart) > 0 &&
		Temporal.PlainDate.compare(d, selEnd) < 0;

	const isEdge = (d: Temporal.PlainDate): boolean =>
		(selStart !== null && d.equals(selStart)) ||
		(selEnd !== null && d.equals(selEnd));

	const weekdays = weekdayLabels();

	/** One day button, carrying its own selection and bounds state */
	const dayCell = (
		d: Temporal.PlainDate,
		ym: Temporal.PlainYearMonth,
	): HTMLButtonElement => {
		const classes = [
			"datepicker-day",
			d.month === ym.month ? "" : "is-outside",
			isEdge(d) ? "is-selected" : "",
			inRange(d) ? "is-in-range" : "",
			d.equals(todayLocal()) ? "is-today" : "",
		]
			.filter(Boolean)
			.join(" ");
		const cell = make(
			"button",
			{
				type: "button",
				class: classes,
				"data-day": d.toString(),
				role: "gridcell",
				"aria-pressed": isEdge(d) ? "true" : "false",
			},
			String(d.day),
		);
		cell.disabled =
			(min !== null && Temporal.PlainDate.compare(d, min) < 0) ||
			(max !== null && Temporal.PlainDate.compare(d, max) > 0);
		return cell;
	};

	const render = (): void => {
		const shown = Array.from({ length: months }, (_, i) =>
			view.add({ months: i }),
		);
		title.textContent = shown.map(monthName).join(" – ");

		shown.forEach((ym, i) => {
			const grid = monthEls[i];
			if (!grid) {
				return;
			}
			grid.replaceChildren(
				...(months > 1
					? [make("div", { class: "datepicker-month-label" }, monthName(ym))]
					: []),
				...weekdays.map((w) =>
					make(
						"span",
						{ class: "datepicker-weekday", role: "columnheader" },
						w,
					),
				),
				...monthCells(ym).map((d) => dayCell(d, ym)),
			);
		});
	};

	// Fills a blank time field with its default, so a defaulted time is visible
	// in the field rather than only present in the value being written
	const ensureTime = (
		input: HTMLInputElement | null,
		fallback: string,
	): string => {
		if (!input) {
			return fallback;
		}
		if (input.value === "") {
			input.value = fallback;
		}
		return input.value;
	};

	const writeValue = (): void => {
		const compose = (
			d: Temporal.PlainDate | null,
			timeInput: HTMLInputElement | null,
			fallback: string,
		): string => {
			if (d === null) {
				return "";
			}
			return mode === "datetime"
				? `${d.toString()}T${ensureTime(timeInput, fallback)}`
				: d.toString();
		};
		start.input.value = compose(selStart, startTime, DEFAULT_START_TIME);
		if (end) {
			end.input.value = compose(selEnd, endTime, DEFAULT_END_TIME);
		}
		for (const i of [start.input, end?.input]) {
			i?.dispatchEvent(new Event("change", { bubbles: true }));
		}
	};

	const close = (): void => {
		panel.hidePopover?.();
	};

	// Closing is only automatic once the selection is complete AND there is
	// nothing left to adjust. In datetime mode the time fields still are, so the
	// popover stays put and is dismissed by clicking away or pressing Escape.
	const commit = (): void => {
		writeValue();
		if (mode === "date") {
			close();
		}
	};

	const pick = (d: Temporal.PlainDate): void => {
		if (!isRange) {
			selStart = d;
			render();
			commit();
			return;
		}
		if (!awaitingEnd || selStart === null) {
			selStart = d;
			selEnd = null;
			awaitingEnd = true;
			render();
			return;
		}
		// Dragging backwards past the start is a range, not an error
		if (Temporal.PlainDate.compare(d, selStart) < 0) {
			selEnd = selStart;
			selStart = d;
		} else {
			selEnd = d;
		}
		awaitingEnd = false;
		render();
		commit();
	};

	grids.addEventListener("click", (e) => {
		const day = (e.target as Element | null)?.closest<HTMLElement>(
			"[data-day]",
		);
		if (day?.dataset.day !== undefined) {
			pick(Temporal.PlainDate.from(day.dataset.day));
		}
	});

	presetCol?.addEventListener("click", (e) => {
		const btn = (e.target as Element | null)?.closest<HTMLElement>(
			"[data-preset]",
		);
		const preset = btn?.dataset.preset;
		if (preset === undefined) {
			return;
		}
		const range = presetRange(preset, todayLocal());
		if (range) {
			selStart = range.start;
			selEnd = range.end;
			awaitingEnd = false;
			view = range.start.toPlainYearMonth();
			render();
			commit();
		}
	});

	prev.addEventListener("click", () => {
		view = view.subtract({ months: 1 });
		render();
	});
	next.addEventListener("click", () => {
		view = view.add({ months: 1 });
		render();
	});
	// Clearing leaves nothing selected, so there is still something to do here
	clearBtn.addEventListener("click", () => {
		selStart = null;
		selEnd = null;
		awaitingEnd = false;
		render();
		writeValue();
	});

	// Editing a time writes through immediately, so dismissing the popover can
	// never silently drop the edit
	for (const timeInput of [startTime, endTime]) {
		timeInput?.addEventListener("change", writeValue);
	}

	const sync = (): void => {
		const s = splitValue(start.input.value);
		selStart = s.date;
		if (startTime && s.time !== "") {
			startTime.value = s.time;
		}
		if (end) {
			const e = splitValue(end.input.value);
			selEnd = e.date;
			if (endTime && e.time !== "") {
				endTime.value = e.time;
			}
		}
		awaitingEnd = false;
		view = (selStart ?? todayLocal()).toPlainYearMonth();
		render();
	};

	const open = (anchor: Element): void => {
		if (typeof panel.showPopover !== "function") {
			return;
		}
		sync();
		panel.showPopover();
		placeUnder(panel, anchor);
	};

	for (const refs of [start, end]) {
		refs?.trigger?.addEventListener("click", () => {
			open(refs.input);
		});
	}

	panel.addEventListener("toggle", (e) => {
		const isOpen = (e as ToggleEvent).newState === "open";
		for (const refs of [start, end]) {
			refs?.trigger?.setAttribute("aria-expanded", String(isOpen));
		}
	});

	render();
};

const initRange = (root: HTMLElement): void => {
	const fields = all<HTMLElement>(root, "[data-date-field]");
	const [startEl, endEl] = fields;
	if (!(startEl && endEl)) {
		return;
	}
	const start = fieldRefs(startEl);
	const end = fieldRefs(endEl);
	if (!(start && end)) {
		return;
	}
	buildPicker({
		mode: root.dataset.mode === "datetime" ? "datetime" : "date",
		presets: (root.dataset.presets ?? "").split(",").filter(Boolean),
		zoneNote: root.dataset.zoneNote ?? "",
		start,
		end,
	});
};

const initSingle = (root: HTMLElement): void => {
	// Fields inside a range are driven by the range's shared picker
	if (root.closest("[data-date-range]")) {
		return;
	}
	const refs = fieldRefs(root);
	if (refs) {
		buildPicker({
			mode: root.dataset.mode === "datetime" ? "datetime" : "date",
			presets: [],
			zoneNote: root.dataset.zoneNote ?? "",
			start: refs,
			end: null,
		});
	}
};

export const initDatePickers = (): void => {
	initAll("[data-date-range]", seen, initRange);
	initAll("[data-date-field]", seen, initSingle);
};
