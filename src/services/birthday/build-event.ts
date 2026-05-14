import { Temporal } from "temporal-polyfill";
import type { IrComponent } from "#src/data/ir.ts";

// ---------------------------------------------------------------------------
// buildBirthdayVevent — pure mapper from a card's (uid, fn, bday) into the
// VEVENT IrComponent we want surfaced in the user's Birthdays calendar.
//
// BDAY shape (already normalised by the card_index trigger):
//   * "YYYY-MM-DD" — year present; DTSTART uses that year
//   * "--MM-DD"    — yearless; DTSTART uses 1604 sentinel year (Apple/MS
//                    convention so clients can detect and hide year/age)
//   * anything else: returns null; the regeneration loop skips these so a
//                    malformed BDAY never blocks the rest of the calendar.
//
// All events get RRULE:FREQ=YEARLY so a single row covers every future
// occurrence. UID is derived from the card UID so regenerate is idempotent
// — repeated runs match by UID and only update when content changed.
// ---------------------------------------------------------------------------

/** Sentinel year for yearless BDAYs. Matches Apple/Outlook convention. */
const YEARLESS_SENTINEL_YEAR = 1604;

export const BIRTHDAY_UID_SUFFIX = "-birthday";

const parseBday = (
	bday: string,
): { readonly date: Temporal.PlainDate; readonly yearless: boolean } | null => {
	if (/^\d{4}-\d{2}-\d{2}$/.test(bday)) {
		try {
			return { date: Temporal.PlainDate.from(bday), yearless: false };
		} catch {
			return null;
		}
	}
	if (/^--\d{2}-\d{2}$/.test(bday)) {
		try {
			return {
				date: Temporal.PlainDate.from(
					`${YEARLESS_SENTINEL_YEAR}-${bday.slice(2)}`,
				),
				yearless: true,
			};
		} catch {
			return null;
		}
	}
	return null;
};

export interface BirthdayVeventInput {
	readonly cardUid: string;
	readonly fn: string;
	readonly bday: string;
}

export interface BirthdayVevent {
	readonly uid: string;
	readonly component: IrComponent;
	readonly yearless: boolean;
}

export const buildBirthdayVevent = (
	input: BirthdayVeventInput,
): BirthdayVevent | null => {
	const parsed = parseBday(input.bday);
	if (parsed === null) {
		return null;
	}
	const uid = `${input.cardUid}${BIRTHDAY_UID_SUFFIX}`;
	const summary = `${input.fn}'s birthday`;

	const component: IrComponent = {
		name: "VEVENT",
		properties: [
			{
				name: "UID",
				parameters: [],
				value: { type: "TEXT", value: uid },
				isKnown: true,
			},
			{
				name: "SUMMARY",
				parameters: [],
				value: { type: "TEXT", value: summary },
				isKnown: true,
			},
			{
				name: "DTSTART",
				parameters: [{ name: "VALUE", value: "DATE" }],
				value: { type: "DATE", value: parsed.date },
				isKnown: true,
			},
			{
				name: "RRULE",
				parameters: [],
				value: { type: "RECUR", value: "FREQ=YEARLY" },
				isKnown: true,
			},
			{
				name: "TRANSP",
				parameters: [],
				value: { type: "TEXT", value: "TRANSPARENT" },
				isKnown: true,
			},
			...(parsed.yearless
				? [
						{
							name: "X-APPLE-OMIT-YEAR",
							parameters: [],
							value: {
								type: "TEXT" as const,
								value: String(YEARLESS_SENTINEL_YEAR),
							},
							isKnown: false,
						},
					]
				: []),
		],
		components: [],
	};

	return { uid, component, yearless: parsed.yearless };
};
