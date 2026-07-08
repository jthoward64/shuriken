import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Temporal } from "temporal-polyfill";
import { buildVtodoComponent } from "./build-vtodo.ts";
import { parseVtodoToForm } from "./parse-vtodo.ts";
import { emptyTaskForm } from "./types.ts";

describe("buildVtodoComponent / parseVtodoToForm round-trip", () => {
	it("preserves an all-day task with a due date and weekly recurrence", () => {
		const form = {
			...emptyTaskForm,
			summary: "Water plants",
			description: "Weekly chore",
			location: "Backyard",
			categoriesCsv: "chores, recurring",
			allDay: true,
			due: "2026-06-02",
			status: "NEEDS-ACTION" as const,
			priority: "5",
			recurrenceFreq: "WEEKLY" as const,
			recurrenceCount: "10",
			recurrenceUntil: "",
		};
		const vtodo = buildVtodoComponent("task-1", form, null);
		expect(vtodo).not.toBeNull();
		const back = parseVtodoToForm(vtodo as NonNullable<typeof vtodo>);
		expect(back.summary).toBe(form.summary);
		expect(back.description).toBe(form.description);
		expect(back.location).toBe(form.location);
		expect(back.categoriesCsv).toBe("chores, recurring");
		expect(back.allDay).toBe(true);
		expect(back.due).toBe(form.due);
		expect(back.status).toBe("NEEDS-ACTION");
		expect(back.priority).toBe("5");
		expect(back.recurrenceFreq).toBe("WEEKLY");
		expect(back.recurrenceCount).toBe("10");
	});

	it("preserves a timed task without DTSTART/DUE (RFC 5545 allows both absent)", () => {
		const form = {
			...emptyTaskForm,
			summary: "Someday task",
		};
		const vtodo = buildVtodoComponent("task-2", form, null);
		expect(vtodo).not.toBeNull();
		const back = parseVtodoToForm(vtodo as NonNullable<typeof vtodo>);
		expect(back.start).toBe("");
		expect(back.due).toBe("");
	});

	it("returns null when SUMMARY is empty", () => {
		expect(buildVtodoComponent("task-3", emptyTaskForm, null)).toBeNull();
	});

	it("stamps COMPLETED when completedAt is provided", () => {
		const completedAt = Temporal.ZonedDateTime.from(
			"2026-06-01T10:00:00Z[UTC]",
		);
		const vtodo = buildVtodoComponent(
			"task-4",
			{ ...emptyTaskForm, summary: "Done thing", status: "COMPLETED" },
			completedAt,
		);
		const completed = vtodo?.properties.find((p) => p.name === "COMPLETED");
		expect(completed?.value).toMatchObject({
			type: "DATE_TIME",
			value: completedAt,
		});
	});

	it("omits COMPLETED when completedAt is null", () => {
		const vtodo = buildVtodoComponent(
			"task-5",
			{ ...emptyTaskForm, summary: "Not done", status: "NEEDS-ACTION" },
			null,
		);
		expect(
			vtodo?.properties.find((p) => p.name === "COMPLETED"),
		).toBeUndefined();
	});

	it("encodes RRULE UNTIL for date-only tasks", () => {
		const v = buildVtodoComponent(
			"task-6",
			{
				...emptyTaskForm,
				summary: "X",
				allDay: true,
				due: "2026-06-01",
				recurrenceFreq: "DAILY",
				recurrenceUntil: "2026-07-01",
			},
			null,
		);
		const rrule = v?.properties.find((p) => p.name === "RRULE");
		expect(rrule?.value).toMatchObject({
			type: "RECUR",
			value: "FREQ=DAILY;UNTIL=20260701",
		});
	});
});
