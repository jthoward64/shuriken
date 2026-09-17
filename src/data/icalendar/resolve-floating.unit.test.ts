import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Temporal } from "temporal-polyfill";
import {
	resolutionZone,
	resolveFloatingDate,
	resolveFloatingDateEnd,
	resolveFloatingDateTime,
	UTC,
} from "./resolve-floating.ts";

describe("resolutionZone", () => {
	it("accepts an IANA zone", () => {
		expect(resolutionZone("Europe/Berlin")).toBe("Europe/Berlin");
	});

	it("falls back to UTC for an unknown zone rather than throwing", () => {
		expect(resolutionZone("Mars/Olympus_Mons")).toBe(UTC);
		expect(resolutionZone("'; DROP TABLE dav_property; --")).toBe(UTC);
	});

	it("falls back to UTC for absent or empty input", () => {
		expect(resolutionZone(undefined)).toBe(UTC);
		expect(resolutionZone(null)).toBe(UTC);
		expect(resolutionZone("")).toBe(UTC);
	});

	// Mozilla/Oracle clients version-prefix a real IANA name
	it("unwraps a prefixed TZID to its IANA name", () => {
		expect(resolutionZone("/mozilla.org/20050126_1/Europe/Berlin")).toBe(
			"Europe/Berlin",
		);
	});

	it("falls back to UTC when a prefixed TZID wraps an unknown zone", () => {
		expect(resolutionZone("/example.com/1/Nowhere/Nothing")).toBe(UTC);
	});
});

describe("resolveFloatingDateTime", () => {
	const wall = Temporal.PlainDateTime.from("2026-06-01T09:00");

	it("resolves against the supplied zone, not the server's", () => {
		const berlin = resolveFloatingDateTime(
			wall,
			resolutionZone("Europe/Berlin"),
		);
		// CEST in June: 09:00 local is 07:00Z
		expect(berlin.toString()).toBe("2026-06-01T07:00:00Z");
	});

	it("gives a different instant per zone for the same wall time", () => {
		const berlin = resolveFloatingDateTime(
			wall,
			resolutionZone("Europe/Berlin"),
		);
		const shanghai = resolveFloatingDateTime(
			wall,
			resolutionZone("Asia/Shanghai"),
		);
		const utc = resolveFloatingDateTime(wall, UTC);
		expect(berlin.epochMilliseconds).not.toBe(shanghai.epochMilliseconds);
		expect(utc.toString()).toBe("2026-06-01T09:00:00Z");
	});

	// 02:30 does not exist in Berlin on the spring-forward day
	it("pushes a DST-gap wall time forward by the gap", () => {
		const gap = Temporal.PlainDateTime.from("2026-03-29T02:30");
		const resolved = resolveFloatingDateTime(
			gap,
			resolutionZone("Europe/Berlin"),
		);
		expect(resolved.toString()).toBe("2026-03-29T01:30:00Z");
	});

	// 02:30 happens twice in Berlin on the autumn fall-back day
	it("takes the earlier offset for an ambiguous wall time", () => {
		const ambiguous = Temporal.PlainDateTime.from("2026-10-25T02:30");
		const resolved = resolveFloatingDateTime(
			ambiguous,
			resolutionZone("Europe/Berlin"),
		);
		expect(resolved.toString()).toBe("2026-10-25T00:30:00Z");
	});
});

describe("resolveFloatingDate", () => {
	it("uses the start of the day in the supplied zone", () => {
		const day = Temporal.PlainDate.from("2026-06-01");
		expect(
			resolveFloatingDate(day, resolutionZone("Europe/Berlin")).toString(),
		).toBe("2026-05-31T22:00:00Z");
		expect(resolveFloatingDate(day, UTC).toString()).toBe(
			"2026-06-01T00:00:00Z",
		);
	});

	it("ends an all-day event at the start of the next day", () => {
		const day = Temporal.PlainDate.from("2026-06-01");
		expect(
			resolveFloatingDateEnd(day, resolutionZone("Europe/Berlin")).toString(),
		).toBe("2026-06-01T22:00:00Z");
	});

	// Some zones have no midnight on a transition day
	it("handles a zone whose day does not start at midnight", () => {
		const day = Temporal.PlainDate.from("2026-09-06");
		const resolved = resolveFloatingDate(
			day,
			resolutionZone("America/Santiago"),
		);
		expect(resolved).toBeInstanceOf(Temporal.Instant);
	});
});
