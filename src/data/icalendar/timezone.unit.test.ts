import { describe, expect, it } from "bun:test";
import { Effect, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type { IrComponent, IrDocument } from "../ir.ts";
import { extractVtimezones } from "./timezone.ts";

// ---------------------------------------------------------------------------
// Test helpers — build minimal IrDocuments without going through the parser
// ---------------------------------------------------------------------------

const makeVcalendar = (components: ReadonlyArray<IrComponent>): IrDocument => ({
	kind: "icalendar",
	root: {
		name: "VCALENDAR",
		properties: [
			{ name: "VERSION", parameters: [], value: { type: "TEXT", value: "2.0" }, isKnown: true },
			{ name: "PRODID", parameters: [], value: { type: "TEXT", value: "-//Test//EN" }, isKnown: true },
		],
		components,
	},
});

const makeVcard = (): IrDocument => ({
	kind: "vcard",
	root: {
		name: "VCARD",
		properties: [
			{ name: "FN", parameters: [], value: { type: "TEXT", value: "Test" }, isKnown: false },
		],
		components: [],
	},
});

/** A minimal VTIMEZONE with only TZID (no LAST-MODIFIED, no X-LIC-LOCATION). */
const makeVtimezone = (tzid: string, extra: Partial<{
	ianaName: string;
	lastModified: Temporal.ZonedDateTime;
}> = {}): IrComponent => ({
	name: "VTIMEZONE",
	properties: [
		{ name: "TZID", parameters: [], value: { type: "TEXT", value: tzid }, isKnown: true },
		...(extra.ianaName !== undefined
			? [{ name: "X-LIC-LOCATION", parameters: [], value: { type: "TEXT" as const, value: extra.ianaName }, isKnown: false }]
			: []),
		...(extra.lastModified !== undefined
			? [{ name: "LAST-MODIFIED", parameters: [], value: { type: "DATE_TIME" as const, value: extra.lastModified }, isKnown: true }]
			: []),
	],
	// Minimal STANDARD sub-component so encoding produces a non-trivial result
	components: [
		{
			name: "STANDARD",
			properties: [
				{ name: "TZOFFSETFROM", parameters: [], value: { type: "UTC_OFFSET", value: "-0500" }, isKnown: true },
				{ name: "TZOFFSETTO", parameters: [], value: { type: "UTC_OFFSET", value: "-0500" }, isKnown: true },
				{ name: "DTSTART", parameters: [], value: { type: "PLAIN_DATE_TIME", value: Temporal.PlainDateTime.from("1970-01-01T00:00:00") }, isKnown: true },
			],
			components: [],
		},
	],
});

const run = <A>(effect: Effect.Effect<A, never, never>): Promise<A> =>
	Effect.runPromise(effect);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("extractVtimezones", () => {
	it("returns an empty array for a vCard document", async () => {
		const result = await run(extractVtimezones(makeVcard()));
		expect(result).toHaveLength(0);
	});

	it("returns an empty array for a VCALENDAR with no VTIMEZONE components", async () => {
		const doc = makeVcalendar([
			{
				name: "VEVENT",
				properties: [
					{ name: "UID", parameters: [], value: { type: "TEXT", value: "uid@example.com" }, isKnown: true },
				],
				components: [],
			},
		]);
		const result = await run(extractVtimezones(doc));
		expect(result).toHaveLength(0);
	});

	it("extracts the TZID from a VTIMEZONE component", async () => {
		const doc = makeVcalendar([makeVtimezone("America/New_York")]);
		const [result] = await run(extractVtimezones(doc));
		expect(result?.tzid).toBe("America/New_York");
	});

	it("vtimezoneData starts with BEGIN:VTIMEZONE and ends with END:VTIMEZONE", async () => {
		const doc = makeVcalendar([makeVtimezone("America/New_York")]);
		const [result] = await run(extractVtimezones(doc));
		expect(result?.vtimezoneData).toStartWith("BEGIN:VTIMEZONE\r\n");
		expect(result?.vtimezoneData).toEndWith("END:VTIMEZONE\r\n");
	});

	it("vtimezoneData includes the TZID line and STANDARD sub-component", async () => {
		const doc = makeVcalendar([makeVtimezone("America/New_York")]);
		const [result] = await run(extractVtimezones(doc));
		expect(result?.vtimezoneData).toContain("TZID:America/New_York\r\n");
		expect(result?.vtimezoneData).toContain("BEGIN:STANDARD\r\n");
		expect(result?.vtimezoneData).toContain("END:STANDARD\r\n");
	});

	it("extracts ianaName from X-LIC-LOCATION when present", async () => {
		const doc = makeVcalendar([
			makeVtimezone("America/New_York", { ianaName: "America/New_York" }),
		]);
		const [result] = await run(extractVtimezones(doc));
		expect(Option.isSome(result?.ianaName ?? Option.none())).toBe(true);
		expect(Option.getOrUndefined(result?.ianaName ?? Option.none())).toBe(
			"America/New_York",
		);
	});

	it("returns Option.none for ianaName when X-LIC-LOCATION is absent", async () => {
		const doc = makeVcalendar([makeVtimezone("America/New_York")]);
		const [result] = await run(extractVtimezones(doc));
		expect(Option.isNone(result?.ianaName ?? Option.none())).toBe(true);
	});

	it("returns Option.some(Instant) for lastModified when LAST-MODIFIED is present", async () => {
		const lastModifiedZdt = Temporal.ZonedDateTime.from(
			"2020-06-15T00:00:00+00:00[UTC]",
		);
		const doc = makeVcalendar([
			makeVtimezone("America/New_York", { lastModified: lastModifiedZdt }),
		]);
		const [result] = await run(extractVtimezones(doc));
		const lm = result?.lastModified ?? Option.none<Temporal.Instant>();
		expect(Option.isSome(lm)).toBe(true);
		expect(
			Option.getOrThrow(lm).equals(lastModifiedZdt.toInstant()),
		).toBe(true);
	});

	it("returns Option.none for lastModified when LAST-MODIFIED is absent", async () => {
		const doc = makeVcalendar([makeVtimezone("America/New_York")]);
		const [result] = await run(extractVtimezones(doc));
		expect(Option.isNone(result?.lastModified ?? Option.none())).toBe(true);
	});

	it("skips VTIMEZONE components that are missing the TZID property", async () => {
		const noTzid: IrComponent = {
			name: "VTIMEZONE",
			properties: [], // no TZID
			components: [],
		};
		const doc = makeVcalendar([noTzid, makeVtimezone("Europe/London")]);
		const result = await run(extractVtimezones(doc));
		expect(result).toHaveLength(1);
		expect(result[0]?.tzid).toBe("Europe/London");
	});

	it("extracts all VTIMEZONEs when VCALENDAR has more than one", async () => {
		const doc = makeVcalendar([
			makeVtimezone("America/New_York"),
			makeVtimezone("Europe/London"),
		]);
		const result = await run(extractVtimezones(doc));
		expect(result).toHaveLength(2);
		const tzids = result.map((r) => r.tzid);
		expect(tzids).toContain("America/New_York");
		expect(tzids).toContain("Europe/London");
	});
});
