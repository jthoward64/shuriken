import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import {
	extractTzidFromVtimezone,
	resolveCalendarZone,
} from "./calendar-zone.ts";
import { UTC } from "./resolve-floating.ts";

const vtimezone = (tzid: string): string =>
	[
		"BEGIN:VCALENDAR",
		"BEGIN:VTIMEZONE",
		`TZID:${tzid}`,
		"END:VTIMEZONE",
		"END:VCALENDAR",
	].join("\r\n");

describe("extractTzidFromVtimezone", () => {
	it("reads the TZID line", () => {
		expect(extractTzidFromVtimezone(vtimezone("Europe/Berlin"))).toBe(
			"Europe/Berlin",
		);
	});

	it("returns null when there is no TZID line", () => {
		expect(
			extractTzidFromVtimezone("BEGIN:VCALENDAR\r\nEND:VCALENDAR"),
		).toBeNull();
	});
});

// RFC 4791 section 7.3 precedence
describe("resolveCalendarZone", () => {
	it("prefers the request's CALDAV:timezone over the collection's", () => {
		expect(
			resolveCalendarZone({
				requestTimezone: vtimezone("Asia/Shanghai"),
				collectionTzid: "Europe/Berlin",
			}),
		).toBe("Asia/Shanghai");
	});

	it("prefers CALDAV:timezone over CALDAV:timezone-id", () => {
		expect(
			resolveCalendarZone({
				requestTimezone: vtimezone("Asia/Shanghai"),
				requestTzid: "Europe/Berlin",
			}),
		).toBe("Asia/Shanghai");
	});

	it("uses timezone-id when no VTIMEZONE is sent", () => {
		expect(
			resolveCalendarZone({
				requestTzid: "Europe/Berlin",
				collectionTzid: "America/New_York",
			}),
		).toBe("Europe/Berlin");
	});

	it("falls back to the collection's zone when the request names none", () => {
		expect(resolveCalendarZone({ collectionTzid: "Europe/Berlin" })).toBe(
			"Europe/Berlin",
		);
	});

	it("falls back to UTC when no source names a zone", () => {
		expect(resolveCalendarZone({})).toBe(UTC);
		expect(
			resolveCalendarZone({ requestTimezone: null, collectionTzid: null }),
		).toBe(UTC);
	});

	// An unusable source should not consume the whole precedence chain
	it("skips an unknown request zone and uses the collection's", () => {
		expect(
			resolveCalendarZone({
				requestTimezone: vtimezone("Mars/Olympus_Mons"),
				collectionTzid: "Europe/Berlin",
			}),
		).toBe("Europe/Berlin");
	});

	it("falls back to UTC when every source is unusable", () => {
		expect(
			resolveCalendarZone({
				requestTimezone: vtimezone("Mars/Olympus_Mons"),
				collectionTzid: "Nowhere/Nothing",
			}),
		).toBe(UTC);
	});
});
