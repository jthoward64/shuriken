import { describe, expect, test } from "bun:test";
import { Effect, Option } from "effect";
import { IanaTimezoneService } from "./iana.ts";

describe("IanaTimezoneService", () => {
	const runWith = <A>(eff: Effect.Effect<A, never, IanaTimezoneService>) =>
		Effect.runSync(Effect.provide(eff, IanaTimezoneService.Default));

	describe("isKnownTzid", () => {
		test("returns true for a well-known IANA timezone", () => {
			const result = runWith(
				Effect.gen(function* () {
					const svc = yield* IanaTimezoneService;
					return svc.isKnownTzid("America/New_York");
				}),
			);
			expect(result).toBe(true);
		});

		test("returns true for UTC", () => {
			const result = runWith(
				Effect.gen(function* () {
					const svc = yield* IanaTimezoneService;
					return svc.isKnownTzid("UTC");
				}),
			);
			expect(result).toBe(true);
		});

		test("returns false for an unknown timezone", () => {
			const result = runWith(
				Effect.gen(function* () {
					const svc = yield* IanaTimezoneService;
					return svc.isKnownTzid("Invalid/Zone");
				}),
			);
			expect(result).toBe(false);
		});
	});

	describe("listTzids", () => {
		test("returns a non-empty array of timezone IDs", () => {
			const result = runWith(
				Effect.gen(function* () {
					const svc = yield* IanaTimezoneService;
					return svc.listTzids();
				}),
			);
			expect(result.length).toBeGreaterThan(500);
			expect(result).toContain("America/New_York");
			expect(result).toContain("Europe/London");
			expect(result).toContain("UTC");
		});
	});

	describe("getVtimezone", () => {
		test("returns Some with VTIMEZONE block for a known IANA timezone", () => {
			const result = runWith(
				Effect.gen(function* () {
					const svc = yield* IanaTimezoneService;
					return svc.getVtimezone("America/New_York");
				}),
			);
			expect(Option.isSome(result)).toBe(true);
			const block = Option.getOrThrow(result);
			expect(block).toContain("BEGIN:VTIMEZONE");
			expect(block).toContain("TZID:America/New_York");
			expect(block).toContain("END:VTIMEZONE");
		});

		test("returns None for an unknown timezone", () => {
			const result = runWith(
				Effect.gen(function* () {
					const svc = yield* IanaTimezoneService;
					return svc.getVtimezone("Invalid/Zone");
				}),
			);
			expect(Option.isNone(result)).toBe(true);
		});
	});
});
