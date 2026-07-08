// ---------------------------------------------------------------------------
// Random VEVENT generation + bulk import into a calendar collection.
// ---------------------------------------------------------------------------

import { faker } from "@faker-js/faker";
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import type { IrComponent, IrDocument, IrProperty } from "#src/data/ir.ts";
import type { CollectionId } from "#src/domain/ids.ts";
import { buildVeventComponent } from "#src/services/cal-edit/build-vevent.ts";
import { importIcs } from "#src/services/cal-edit/import-ics.ts";
import {
	type EventFormData,
	emptyEventForm,
} from "#src/services/cal-edit/types.ts";
import { chance, intBetween, pick } from "./random.ts";

const RECURRENCE_FREQS = ["DAILY", "WEEKLY", "MONTHLY"] as const;
const ALL_DAY_PROBABILITY = 0.15;
const RECURRING_PROBABILITY = 0.1;
const ATTENDEE_PROBABILITY = 0.2;
const SECOND_ATTENDEE_PROBABILITY = 0.5;
const DESCRIPTION_PROBABILITY = 0.4;
const LOCATION_PROBABILITY = 0.3;
const PAST_WINDOW_DAYS = 365;
const FUTURE_WINDOW_DAYS = 365;
const LAST_HOUR_OF_DAY = 23;
const MINUTES_PER_HOUR = 60;
const QUARTER_HOUR_COUNT = 4;
const MINUTE_QUARTERS = Array.from(
	{ length: QUARTER_HOUR_COUNT },
	(_, i) => (i * MINUTES_PER_HOUR) / QUARTER_HOUR_COUNT,
);
const HOURS_PER_DAY = 24;
const MIN_EVENT_DURATION_HOURS = 1;
const MAX_EVENT_DURATION_HOURS = 3;
const MIN_RECURRENCE_COUNT = 3;
const MAX_RECURRENCE_COUNT = 30;
const PAD_WIDTH = 2;

const pad2 = (n: number): string => n.toString().padStart(PAD_WIDTH, "0");

const FIRST_HOUR_OF_DAY = 0;

// Split across two `.add()` calls: `days` can be negative while `hours`/
// `minutes` are always non-negative, and Temporal.Duration forbids mixing
// signs within a single duration object.
const randomStart = (): Temporal.PlainDateTime =>
	Temporal.Now.plainDateTimeISO()
		.add({ days: intBetween(-PAST_WINDOW_DAYS, FUTURE_WINDOW_DAYS) })
		.add({
			hours: intBetween(FIRST_HOUR_OF_DAY, LAST_HOUR_OF_DAY),
			minutes: pick(MINUTE_QUARTERS),
		});

const formatEventDateTime = (dt: Temporal.PlainDateTime, allDay: boolean) =>
	allDay
		? dt.toPlainDate().toString()
		: `${dt.toPlainDate().toString()}T${pad2(dt.hour)}:${pad2(dt.minute)}`;

/**
 * A random `EventFormData`. `attendeeEmails`, when given, is a pool other
 * members can be pulled from (used for shared/group calendars); left empty
 * for ordinary personal events.
 */
export const randomEventForm = (
	attendeeEmails: ReadonlyArray<string> = [],
): EventFormData => {
	const allDay = chance(ALL_DAY_PROBABILITY);
	const start = randomStart();
	const durationHours = allDay
		? HOURS_PER_DAY
		: intBetween(MIN_EVENT_DURATION_HOURS, MAX_EVENT_DURATION_HOURS);
	const end = start.add({ hours: durationHours });
	const recurring = chance(RECURRING_PROBABILITY);
	const attendees =
		attendeeEmails.length > 0 && chance(ATTENDEE_PROBABILITY)
			? [
					pick(attendeeEmails),
					...(chance(SECOND_ATTENDEE_PROBABILITY)
						? [pick(attendeeEmails)]
						: []),
				]
			: [];

	return {
		...emptyEventForm,
		summary: faker.company.buzzPhrase(),
		description: chance(DESCRIPTION_PROBABILITY) ? faker.lorem.sentence() : "",
		location: chance(LOCATION_PROBABILITY) ? faker.location.city() : "",
		allDay,
		start: formatEventDateTime(start, allDay),
		end: formatEventDateTime(end, allDay),
		recurrenceFreq: recurring ? pick(RECURRENCE_FREQS) : "",
		recurrenceCount: recurring
			? String(intBetween(MIN_RECURRENCE_COUNT, MAX_RECURRENCE_COUNT))
			: "",
		attendees,
	};
};

const VCALENDAR_HEADER_PROPS: ReadonlyArray<IrProperty> = [
	{
		name: "VERSION",
		parameters: [],
		value: { type: "TEXT", value: "2.0" },
		isKnown: true,
	},
	{
		name: "PRODID",
		parameters: [],
		value: { type: "TEXT", value: "-//shuriken//seed//EN" },
		isKnown: true,
	},
];

const wrapCalendar = (components: ReadonlyArray<IrComponent>): IrDocument => ({
	kind: "icalendar",
	root: {
		name: "VCALENDAR",
		properties: VCALENDAR_HEADER_PROPS,
		components,
	},
});

/**
 * Generate `count` random events for `calendarId`, importing in
 * `batchSize`-sized chunks via the same `importIcs` bulk-import path a real
 * .ics file upload uses.
 */
export const seedEvents = (
	calendarId: CollectionId,
	count: number,
	batchSize: number,
	attendeeEmails: ReadonlyArray<string> = [],
) =>
	Effect.gen(function* () {
		let remaining = count;
		while (remaining > 0) {
			const chunkSize = Math.min(batchSize, remaining);
			const components: Array<IrComponent> = [];
			for (let i = 0; i < chunkSize; i++) {
				const form = randomEventForm(attendeeEmails);
				const component = buildVeventComponent(crypto.randomUUID(), form);
				if (component) {
					components.push(component);
				}
			}
			const body = yield* encodeICalendar(wrapCalendar(components));
			yield* importIcs(calendarId, body, "skip");
			remaining -= chunkSize;
		}
	});
