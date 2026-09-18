import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Option } from "effect";
import { buildBirthdayVevent } from "./build-event.ts";

describe("buildBirthdayVevent", () => {
	it("builds a VEVENT for a year-bearing BDAY", () => {
		const result = buildBirthdayVevent({
			cardUid: "alice-uid",
			fn: "Alice",
			bday: "1985-04-12",
		});
		expect(Option.isSome(result)).toBe(true);
		const built = Option.getOrThrow(result);
		expect(built.uid).toBe("alice-uid-birthday");
		expect(built.yearless).toBe(false);

		const props = built.component.properties;
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
		expect(Option.isSome(result)).toBe(true);
		const built = Option.getOrThrow(result);
		expect(built.yearless).toBe(true);

		const dtstart = built.component.properties.find(
			(p) => p.name === "DTSTART",
		);
		expect(dtstart?.value.type).toBe("DATE");
		if (dtstart?.value.type === "DATE") {
			expect(dtstart.value.value.year).toBe(1604);
			expect(dtstart.value.value.month).toBe(12);
			expect(dtstart.value.value.day).toBe(25);
		}

		const omit = built.component.properties.find(
			(p) => p.name === "X-APPLE-OMIT-YEAR",
		);
		expect(omit?.value).toMatchObject({ type: "TEXT", value: "1604" });
	});

	it("returns none for unrecognised BDAY shapes", () => {
		expect(
			Option.isNone(
				buildBirthdayVevent({ cardUid: "x", fn: "X", bday: "not-a-date" }),
			),
		).toBe(true);
		expect(
			Option.isNone(
				buildBirthdayVevent({
					cardUid: "x",
					fn: "X",
					bday: "19850412T120000Z",
				}),
			),
		).toBe(true);
	});

	it("returns none for impossible dates (Feb 30)", () => {
		expect(
			Option.isNone(
				buildBirthdayVevent({ cardUid: "x", fn: "X", bday: "1990-02-30" }),
			),
		).toBe(true);
	});
});
