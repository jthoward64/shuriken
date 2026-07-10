import type { VNode } from "preact";
import { Temporal } from "temporal-polyfill";
import type { EventFormData } from "#src/services/cal-edit/types.ts";
import { IconEdit } from "../../icons.tsx";

// ---------------------------------------------------------------------------
// Calendar event hover card — a read-only preview shown on both hover and
// click (see calendar.client.ts), separate from the click-to-edit dialog in
// event-popovers.tsx. It's a `popover="manual"` element, not a `<dialog>`:
// non-modal, so it can appear on hover without stealing focus or dimming the
// page, and its open/close is entirely JS-driven (no light-dismiss) so hover
// and click can share the same show/hide logic. Its Edit button opens the
// real edit dialog instead of editing inline.
// ---------------------------------------------------------------------------

export const EVENT_HOVER_CARD_ID = "event-hover-card";
export const EVENT_HOVER_CARD_BODY_ID = "event-hover-card-body";

export const EventHoverCardContainer = (): VNode => (
	<div
		id={EVENT_HOVER_CARD_ID}
		popover="manual"
		role="tooltip"
		class="hover-card"
	>
		<div id={EVENT_HOVER_CARD_BODY_ID} class="hover-card-panel card card-pad" />
	</div>
);

const MONTH_NAMES = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

const pad2 = (n: number): string => String(n).padStart(2, "0");

const HOURS_IN_HALF_DAY = 12;

const to12Hour = (hour: number, minute: number): string => {
	const period = hour < HOURS_IN_HALF_DAY ? "AM" : "PM";
	const h12 =
		hour % HOURS_IN_HALF_DAY === 0
			? HOURS_IN_HALF_DAY
			: hour % HOURS_IN_HALF_DAY;
	return `${h12}:${pad2(minute)} ${period}`;
};

const dateLabel = (d: Temporal.PlainDate | Temporal.PlainDateTime): string =>
	`${MONTH_NAMES[d.month - 1]} ${d.day}, ${d.year}`;

/** Human date/time range for the hover card (start–end, folding the end date
 * in only when it differs from the start date). */
const formatWhen = (form: EventFormData): string => {
	try {
		if (form.allDay) {
			return dateLabel(Temporal.PlainDate.from(form.start));
		}
		const start = Temporal.PlainDateTime.from(form.start);
		const startLabel = `${dateLabel(start)} · ${to12Hour(start.hour, start.minute)}`;
		if (form.end === "") {
			return startLabel;
		}
		const end = Temporal.PlainDateTime.from(form.end);
		return end.toPlainDate().equals(start.toPlainDate())
			? `${startLabel} – ${to12Hour(end.hour, end.minute)}`
			: `${startLabel} – ${dateLabel(end)} · ${to12Hour(end.hour, end.minute)}`;
	} catch {
		return form.start;
	}
};

export const EventHoverCard = ({
	form,
	editHref,
}: {
	form: EventFormData;
	/** Omitted when the caller lacks write access — hides the Edit affordance
	 * rather than linking to a page that would just 403 (or, for read-only
	 * viewers, silently fail to save). */
	editHref?: string;
}): VNode => (
	<>
		<div class="flex items-start justify-between gap-3">
			<h3 class="font-semibold text-fg">{form.summary || "Event"}</h3>
			{editHref !== undefined && (
				<a
					href={editHref}
					data-edit-event
					aria-label="Edit event"
					class="btn btn-ghost btn-sm shrink-0"
				>
					<IconEdit class="h-4 w-4" />
				</a>
			)}
		</div>
		<p class="mt-1 text-sm text-muted">{formatWhen(form)}</p>
		{form.location !== "" && (
			<p class="mt-2 text-sm text-fg">{form.location}</p>
		)}
		{form.description !== "" && (
			<p class="mt-2 whitespace-pre-line text-sm text-muted">
				{form.description}
			</p>
		)}
		{form.organizer !== "" && (
			<p class="mt-2 text-xs text-subtle">Organizer: {form.organizer}</p>
		)}
	</>
);
