import { describe, expect, it } from "bun:test";
import { buildBirthdayVevent } from "./build-event.ts";

describe("buildBirthdayVevent", () => {
	it("builds a VEVENT for a year-bearing BDAY", () => {
		const result = buildBirthdayVevent({
			cardUid: "alice-uid",
			fn: "Alice",
			bday: "1985-04-12",
		});
		expect(result).not.toBeNull();
		expect(result?.uid).toBe("alice-uid-birthday");
		expect(result?.yearless).toBe(false);

		const props = result?.component.properties ?? [];
		const summary = props.find((p) => p.name === "SUMMARY");
		expect(summary?.value).toMatchObject({
			type: "TEXT",
			value: "Alice's birthday",
		});

		const dtstart = props.find((p) => p.name === "DTSTART");
		expect(dtstart?.value.type).toBe("DATE");
		expect(dtstart?.parameters[0]).toEqual({ name: "VALUE", value: "DATE" });

		const rrule = props.find((p) => p.name === "RRULE");
		expect(rrule?.value).toMatchObject({ type: "RECUR", value: "FREQ=YEARLY" });
	});

	it("uses 1604 sentinel year for yearless --MM-DD", () => {
		const result = buildBirthdayVevent({
			cardUid: "bob",
			fn: "Bob",
			bday: "--12-25",
		});
		expect(result).not.toBeNull();
		expect(result?.yearless).toBe(true);

		const dtstart = result?.component.properties.find(
			(p) => p.name === "DTSTART",
		);
		expect(dtstart?.value.type).toBe("DATE");
		if (dtstart?.value.type === "DATE") {
			expect(dtstart.value.value.year).toBe(1604);
			expect(dtstart.value.value.month).toBe(12);
			expect(dtstart.value.value.day).toBe(25);
		}

		const omit = result?.component.properties.find(
			(p) => p.name === "X-APPLE-OMIT-YEAR",
		);
		expect(omit?.value).toMatchObject({ type: "TEXT", value: "1604" });
	});

	it("returns null for unrecognised BDAY shapes", () => {
		expect(
			buildBirthdayVevent({ cardUid: "x", fn: "X", bday: "not-a-date" }),
		).toBeNull();
		expect(
			buildBirthdayVevent({ cardUid: "x", fn: "X", bday: "19850412T120000Z" }),
		).toBeNull();
	});

	it("returns null for impossible dates (Feb 30)", () => {
		expect(
			buildBirthdayVevent({ cardUid: "x", fn: "X", bday: "1990-02-30" }),
		).toBeNull();
	});
});
