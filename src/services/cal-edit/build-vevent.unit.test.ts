import { describe, expect, it } from "bun:test";
import { buildVeventComponent } from "./build-vevent.ts";
import { parseVeventToForm } from "./parse-vevent.ts";
import { emptyEventForm } from "./types.ts";

describe("buildVeventComponent / parseVeventToForm round-trip", () => {
	it("preserves an all-day event with weekly recurrence", () => {
		const form = {
			...emptyEventForm,
			summary: "Standup",
			description: "Daily team sync",
			location: "Zoom",
			categoriesCsv: "work, recurring",
			allDay: true,
			start: "2026-06-01",
			end: "2026-06-02",
			recurrenceFreq: "WEEKLY" as const,
			recurrenceCount: "10",
			recurrenceUntil: "",
		};
		const vevent = buildVeventComponent("evt-1", form);
		expect(vevent).not.toBeNull();
		const back = parseVeventToForm(vevent as NonNullable<typeof vevent>);
		expect(back.summary).toBe(form.summary);
		expect(back.description).toBe(form.description);
		expect(back.location).toBe(form.location);
		expect(back.categoriesCsv).toBe("work, recurring");
		expect(back.allDay).toBe(true);
		expect(back.start).toBe(form.start);
		expect(back.end).toBe(form.end);
		expect(back.recurrenceFreq).toBe("WEEKLY");
		expect(back.recurrenceCount).toBe("10");
	});

	it("preserves a timed event without recurrence", () => {
		const form = {
			...emptyEventForm,
			summary: "Lunch",
			allDay: false,
			start: "2026-06-01T12:30",
			end: "2026-06-01T13:30",
		};
		const vevent = buildVeventComponent("evt-2", form);
		expect(vevent).not.toBeNull();
		const back = parseVeventToForm(vevent as NonNullable<typeof vevent>);
		expect(back.allDay).toBe(false);
		expect(back.start).toBe(form.start);
		expect(back.end).toBe(form.end);
		expect(back.recurrenceFreq).toBe("");
	});

	it("returns null when DTSTART is malformed", () => {
		expect(
			buildVeventComponent("evt-3", {
				...emptyEventForm,
				summary: "X",
				start: "garbage",
			}),
		).toBeNull();
	});

	it("encodes RRULE UNTIL for date-only events", () => {
		const v = buildVeventComponent("evt-4", {
			...emptyEventForm,
			summary: "X",
			allDay: true,
			start: "2026-06-01",
			recurrenceFreq: "DAILY",
			recurrenceUntil: "2026-07-01",
		});
		const rrule = v?.properties.find((p) => p.name === "RRULE");
		expect(rrule?.value).toMatchObject({
			type: "RECUR",
			value: "FREQ=DAILY;UNTIL=20260701",
		});
	});
});
