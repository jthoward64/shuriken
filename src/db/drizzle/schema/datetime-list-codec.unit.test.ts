import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Temporal } from "temporal-polyfill";
import {
	type DatetimeListItem,
	parseDatetimeArray,
	parseDatetimeArrayValue,
	serializeDatetimeArray,
} from "./datetime-list-codec.ts";

const utc = Temporal.ZonedDateTime.from("2023-11-05T01:00:00+00:00[UTC]");
const named = Temporal.ZonedDateTime.from(
	"2024-03-10T03:00:00-04:00[America/New_York]",
);
const offset = Temporal.ZonedDateTime.from("2023-06-01T12:00:00+05:00[+05:00]");
const floating = Temporal.PlainDateTime.from("2023-11-05T01:00:00");

const key = (item: DatetimeListItem): string =>
	"timeZoneId" in item ? `Z:${item.toString()}` : `P:${item.toString()}`;

const roundTrip = (items: ReadonlyArray<DatetimeListItem>) =>
	parseDatetimeArray(serializeDatetimeArray(items));

describe("datetime-list-codec", () => {
	it("serializes a UTC item to the expected composite-array literal", () => {
		expect(serializeDatetimeArray([utc])).toBe(
			'{"(\\"2023-11-05T01:00:00\\",\\"UTC\\")"}',
		);
	});

	it("serializes a floating item with an empty (NULL) zone field", () => {
		expect(serializeDatetimeArray([floating])).toBe(
			'{"(\\"2023-11-05T01:00:00\\",)"}',
		);
	});

	it("serializes an empty list to {}", () => {
		expect(serializeDatetimeArray([])).toBe("{}");
	});

	it("parses {} to an empty list", () => {
		expect(parseDatetimeArray("{}")).toEqual([]);
	});

	it("parses the canonical Postgres form (bare zone, empty NULL zone)", () => {
		// Exactly what postgres.js / PGlite return on read.
		const text =
			'{"(\\"2023-11-05 01:00:00\\",UTC)","(\\"2024-11-03 01:00:00\\",)"}';
		const items = parseDatetimeArray(text);
		expect(items.map(key)).toEqual([
			"Z:2023-11-05T01:00:00+00:00[UTC]",
			"P:2024-11-03T01:00:00",
		]);
	});

	it("round-trips a UTC item", () => {
		expect(roundTrip([utc]).map(key)).toEqual([key(utc)]);
	});

	it("round-trips a named-zone item", () => {
		expect(roundTrip([named]).map(key)).toEqual([key(named)]);
	});

	it("round-trips a fixed-offset item", () => {
		expect(roundTrip([offset]).map(key)).toEqual([key(offset)]);
	});

	it("round-trips a floating item as a PlainDateTime", () => {
		const [item] = roundTrip([floating]);
		expect(item && "timeZoneId" in item).toBe(false);
		expect(item?.toString()).toBe("2023-11-05T01:00:00");
	});

	it("round-trips a mixed list, preserving order", () => {
		const items = [floating, utc, named, offset];
		expect(roundTrip(items).map(key)).toEqual(items.map(key));
	});

	it("parses the pre-split array shape that @effect/sql clients return", () => {
		// effect-sql clients hand fromDriver an array of record literals rather
		// than the full "{...}" text.
		const items = parseDatetimeArrayValue([
			'("2023-11-05 01:00:00",UTC)',
			'("2024-11-03 01:00:00",)',
		]);
		expect(items.map(key)).toEqual([
			"Z:2023-11-05T01:00:00+00:00[UTC]",
			"P:2024-11-03T01:00:00",
		]);
	});

	it("parses an empty pre-split array to an empty list", () => {
		expect(parseDatetimeArrayValue([])).toEqual([]);
	});
});
