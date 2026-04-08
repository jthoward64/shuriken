import { beforeAll, describe, expect, it } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import { runSuccess } from "#src/testing/effect.ts";
import { makePgliteDatabaseLayer } from "#src/testing/pglite.ts";
import { CalTimezoneRepositoryLive } from "./repository.live.ts";
import { CalTimezoneRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// Integration tests for CalTimezoneRepositoryLive
//
// Each describe block gets its own PGlite instance (via beforeAll) so that
// upsert-conflict tests start from a known empty state.
// ---------------------------------------------------------------------------

type TestLayer = Layer.Layer<CalTimezoneRepository, Error>;

function makeTestLayer(): TestLayer {
	return CalTimezoneRepositoryLive.pipe(
		Layer.provide(makePgliteDatabaseLayer()),
	);
}

const TZID = "America/New_York";
const VTIMEZONE_DATA =
	"BEGIN:VTIMEZONE\r\nTZID:America/New_York\r\n" +
	"BEGIN:STANDARD\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\n" +
	"DTSTART:19671029T020000\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n";

const VTIMEZONE_DATA_V2 =
	"BEGIN:VTIMEZONE\r\nTZID:America/New_York\r\nX-UPDATED:YES\r\n" +
	"BEGIN:STANDARD\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\n" +
	"DTSTART:19671029T020000\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n";

// ---------------------------------------------------------------------------
// findByTzid
// ---------------------------------------------------------------------------

describe("CalTimezoneRepository.findByTzid (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("returns None for an unknown TZID", async () => {
		const result = await runSuccess(
			CalTimezoneRepository.pipe(
				Effect.flatMap((r) => r.findByTzid("Does/Not/Exist")),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(Option.isNone(result)).toBe(true);
	});

	it("returns Some with the row after upsert", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const repo = yield* CalTimezoneRepository;
				yield* repo.upsert(TZID, VTIMEZONE_DATA, Option.none(), Option.none());
				return yield* repo.findByTzid(TZID);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(Option.isSome(result)).toBe(true);
		expect(Option.getOrThrow(result).tzid).toBe(TZID);
		expect(Option.getOrThrow(result).vtimezoneData).toBe(VTIMEZONE_DATA);
	});
});

// ---------------------------------------------------------------------------
// upsert — insert path
// ---------------------------------------------------------------------------

describe("CalTimezoneRepository.upsert — insert (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("inserts a new row and returns it with the correct fields", async () => {
		const ianaName = Option.some("America/New_York");
		const lastModified = Option.some(
			Temporal.Instant.from("2020-01-01T00:00:00Z"),
		);

		const row = await runSuccess(
			CalTimezoneRepository.pipe(
				Effect.flatMap((r) =>
					r.upsert("Europe/Berlin", VTIMEZONE_DATA, ianaName, lastModified),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(row.tzid).toBe("Europe/Berlin");
		expect(row.vtimezoneData).toBe(VTIMEZONE_DATA);
		expect(row.ianaName).toBe("America/New_York");
		expect(row.lastModifiedAt).not.toBeNull();
	});

	it("stores null ianaName when Option.none() is provided", async () => {
		const row = await runSuccess(
			CalTimezoneRepository.pipe(
				Effect.flatMap((r) =>
					r.upsert(
						"Pacific/Auckland",
						VTIMEZONE_DATA,
						Option.none(),
						Option.none(),
					),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(row.ianaName).toBeNull();
		expect(row.lastModifiedAt).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// upsert — conflict resolution (RFC 5545 §3.6.5 LAST-MODIFIED rules)
// ---------------------------------------------------------------------------

describe("CalTimezoneRepository.upsert — conflict resolution (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("overwrites vtimezoneData when incoming lastModified is absent (recency unknown)", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const repo = yield* CalTimezoneRepository;
				const stored = Temporal.Instant.from("2019-01-01T00:00:00Z");
				// First insert with a known lastModified
				yield* repo.upsert(
					TZID,
					VTIMEZONE_DATA,
					Option.none(),
					Option.some(stored),
				);
				// Upsert again with no lastModified (recency unknown → must overwrite)
				yield* repo.upsert(
					TZID,
					VTIMEZONE_DATA_V2,
					Option.none(),
					Option.none(),
				);
				return yield* repo.findByTzid(TZID);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(Option.getOrThrow(result).vtimezoneData).toBe(VTIMEZONE_DATA_V2);
	});

	it("overwrites vtimezoneData when incoming lastModified is newer", async () => {
		const tzid = "Asia/Tokyo";
		const result = await runSuccess(
			Effect.gen(function* () {
				const repo = yield* CalTimezoneRepository;
				const older = Temporal.Instant.from("2018-01-01T00:00:00Z");
				const newer = Temporal.Instant.from("2022-01-01T00:00:00Z");
				yield* repo.upsert(
					tzid,
					VTIMEZONE_DATA,
					Option.none(),
					Option.some(older),
				);
				yield* repo.upsert(
					tzid,
					VTIMEZONE_DATA_V2,
					Option.none(),
					Option.some(newer),
				);
				return yield* repo.findByTzid(tzid);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(Option.getOrThrow(result).vtimezoneData).toBe(VTIMEZONE_DATA_V2);
	});

	it("preserves vtimezoneData when incoming lastModified is older", async () => {
		const tzid = "Australia/Sydney";
		const result = await runSuccess(
			Effect.gen(function* () {
				const repo = yield* CalTimezoneRepository;
				const newer = Temporal.Instant.from("2022-01-01T00:00:00Z");
				const older = Temporal.Instant.from("2018-01-01T00:00:00Z");
				yield* repo.upsert(
					tzid,
					VTIMEZONE_DATA,
					Option.none(),
					Option.some(newer),
				);
				yield* repo.upsert(
					tzid,
					VTIMEZONE_DATA_V2,
					Option.none(),
					Option.some(older),
				);
				return yield* repo.findByTzid(tzid);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		// Original data must be preserved — stale client sent an older definition
		expect(Option.getOrThrow(result).vtimezoneData).toBe(VTIMEZONE_DATA);
	});
});

// ---------------------------------------------------------------------------
// upsert — ianaName update rules
// ---------------------------------------------------------------------------

describe("CalTimezoneRepository.upsert — ianaName rules (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("updates ianaName when Option.some is provided", async () => {
		const tzid = "US/Eastern";
		const result = await runSuccess(
			Effect.gen(function* () {
				const repo = yield* CalTimezoneRepository;
				yield* repo.upsert(tzid, VTIMEZONE_DATA, Option.none(), Option.none());
				yield* repo.upsert(
					tzid,
					VTIMEZONE_DATA,
					Option.some("America/New_York"),
					Option.none(),
				);
				return yield* repo.findByTzid(tzid);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(Option.getOrThrow(result).ianaName).toBe("America/New_York");
	});

	it("preserves existing ianaName when Option.none is provided", async () => {
		const tzid = "US/Central";
		const result = await runSuccess(
			Effect.gen(function* () {
				const repo = yield* CalTimezoneRepository;
				yield* repo.upsert(
					tzid,
					VTIMEZONE_DATA,
					Option.some("America/Chicago"),
					Option.none(),
				);
				// Second upsert with Option.none() must NOT clear the ianaName
				yield* repo.upsert(
					tzid,
					VTIMEZONE_DATA_V2,
					Option.none(),
					Option.none(),
				);
				return yield* repo.findByTzid(tzid);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(Option.getOrThrow(result).ianaName).toBe("America/Chicago");
	});
});
