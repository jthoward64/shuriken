/** biome-ignore-all lint/style/noMagicNumbers: human-readable interval defaults */

// ---------------------------------------------------------------------------
// HolidayPresets — curated list of public-holiday iCal feeds offered as
// one-click subscription options. URLs come from upstream providers and are
// what we'd point users at anyway; the value here is convenience plus a
// consistent default sync interval.
//
// Updates: add or correct entries directly. There's no need for a registry
// — this list is small enough to be hand-maintained.
// ---------------------------------------------------------------------------

export interface HolidayPreset {
	readonly id: string;
	readonly displayName: string;
	readonly url: string;
}

export const HOLIDAY_PRESETS: ReadonlyArray<HolidayPreset> = [
	{
		id: "us",
		displayName: "United States holidays",
		url: "https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics",
	},
	{
		id: "uk",
		displayName: "United Kingdom holidays",
		url: "https://calendar.google.com/calendar/ical/en.uk%23holiday%40group.v.calendar.google.com/public/basic.ics",
	},
	{
		id: "ca",
		displayName: "Canada holidays",
		url: "https://calendar.google.com/calendar/ical/en.canadian%23holiday%40group.v.calendar.google.com/public/basic.ics",
	},
	{
		id: "au",
		displayName: "Australia holidays",
		url: "https://calendar.google.com/calendar/ical/en.australian%23holiday%40group.v.calendar.google.com/public/basic.ics",
	},
	{
		id: "de",
		displayName: "Germany holidays",
		url: "https://calendar.google.com/calendar/ical/en.german%23holiday%40group.v.calendar.google.com/public/basic.ics",
	},
];

const ONE_DAY_S = 24 * 60 * 60;
/** Default sync interval for holiday presets: 50 days. */
export const HOLIDAY_SYNC_INTERVAL_S = 50 * ONE_DAY_S;
