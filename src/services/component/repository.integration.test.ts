import { beforeAll, describe, expect, it } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { Temporal } from "temporal-polyfill";
import type { IrComponent } from "#src/data/ir.ts";
import { EntityId } from "#src/domain/ids.ts";
import { runSuccess } from "#src/testing/effect.ts";
import { makePgliteDatabaseLayer } from "#src/testing/pglite.ts";
import { EntityRepositoryLive } from "#src/services/entity/repository.live.ts";
import { EntityRepository } from "#src/services/entity/repository.ts";
import { ComponentRepositoryLive } from "./repository.live.ts";
import { ComponentRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// Integration tests for ComponentRepositoryLive
//
// dav_entity has no FK to principal, so only EntityRepository is needed as a
// dependency to create the required parent entity rows.
// ---------------------------------------------------------------------------

type TestLayer = Layer.Layer<ComponentRepository | EntityRepository, Error>;

function makeTestLayer(): TestLayer {
	const db = makePgliteDatabaseLayer();
	return Layer.mergeAll(
		EntityRepositoryLive.pipe(Layer.provide(db)),
		ComponentRepositoryLive.pipe(Layer.provide(db)),
	);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeEntity = (entityType: "icalendar" | "vcard" = "icalendar") =>
	EntityRepository.pipe(
		Effect.flatMap((r) => r.insert({ entityType, logicalUid: null })),
	);

// ---------------------------------------------------------------------------
// insertTree / loadTree — basic round-trip
// ---------------------------------------------------------------------------

describe("ComponentRepository insertTree + loadTree (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("persists and reconstructs a multi-level tree (VCALENDAR → VEVENT)", async () => {
		const tree: IrComponent = {
			name: "VCALENDAR",
			properties: [
				{
					name: "VERSION",
					parameters: [],
					value: { type: "TEXT", value: "2.0" },
					isKnown: true,
				},
			],
			components: [
				{
					name: "VEVENT",
					properties: [
						{
							name: "SUMMARY",
							parameters: [],
							value: { type: "TEXT", value: "Team meeting" },
							isKnown: true,
						},
						{
							name: "DTSTART",
							parameters: [{ name: "TZID", value: "America/New_York" }],
							value: {
								type: "DATE_TIME",
								value: Temporal.ZonedDateTime.from(
									"2026-04-04T09:00:00[America/New_York]",
								),
							},
							isKnown: true,
						},
					],
					components: [],
				},
			],
		};

		const result = await runSuccess(
			Effect.gen(function* () {
				const entity = yield* makeEntity("icalendar");
				const entityId = EntityId(entity.id);
				const comp = yield* ComponentRepository;
				yield* comp.insertTree(entityId, tree);
				return yield* comp.loadTree(entityId, "icalendar");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isSome(result)).toBe(true);
		const root = Option.getOrThrow(result);
		expect(root.name).toBe("VCALENDAR");
		expect(root.properties).toHaveLength(1);
		expect(root.properties[0]?.name).toBe("VERSION");
		expect(root.components).toHaveLength(1);
		expect(root.components[0]?.name).toBe("VEVENT");
		expect(root.components[0]?.properties).toHaveLength(2);
		expect(root.components[0]?.properties[0]?.name).toBe("SUMMARY");
		expect(root.components[0]?.properties[1]?.name).toBe("DTSTART");
	});

	it("loadTree returns Option.none() for an unknown entityId", async () => {
		const result = await runSuccess(
			ComponentRepository.pipe(
				Effect.flatMap((r) =>
					r.loadTree(EntityId(crypto.randomUUID()), "icalendar"),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(Option.isNone(result)).toBe(true);
	});

	it("loadTree returns Option.none() after deleteByEntity", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const entity = yield* makeEntity();
				const entityId = EntityId(entity.id);
				const comp = yield* ComponentRepository;
				yield* comp.insertTree(entityId, {
					name: "VCALENDAR",
					properties: [],
					components: [],
				});
				yield* comp.deleteByEntity(entityId);
				return yield* comp.loadTree(entityId, "icalendar");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isNone(result)).toBe(true);
	});

	it("deleteByEntity on an entity with no components is a no-op", async () => {
		await runSuccess(
			Effect.gen(function* () {
				const entity = yield* makeEntity();
				const comp = yield* ComponentRepository;
				yield* comp.deleteByEntity(EntityId(entity.id));
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
	});
});

// ---------------------------------------------------------------------------
// Value type round-trips
// ---------------------------------------------------------------------------

describe("ComponentRepository value type round-trips (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("round-trips TEXT value", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const entity = yield* makeEntity();
				const entityId = EntityId(entity.id);
				const comp = yield* ComponentRepository;
				yield* comp.insertTree(entityId, {
					name: "VCALENDAR",
					properties: [
						{
							name: "SUMMARY",
							parameters: [],
							value: { type: "TEXT", value: "Hello, world!" },
							isKnown: true,
						},
					],
					components: [],
				});
				return yield* comp.loadTree(entityId, "icalendar");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		const root = Option.getOrThrow(result);
		expect(root.properties[0]?.value).toEqual({
			type: "TEXT",
			value: "Hello, world!",
		});
	});

	it("round-trips DATE (PlainDate) value", async () => {
		const date = Temporal.PlainDate.from("2026-04-04");
		const result = await runSuccess(
			Effect.gen(function* () {
				const entity = yield* makeEntity();
				const entityId = EntityId(entity.id);
				const comp = yield* ComponentRepository;
				yield* comp.insertTree(entityId, {
					name: "VCALENDAR",
					properties: [
						{
							name: "DTSTART",
							parameters: [],
							value: { type: "DATE", value: date },
							isKnown: true,
						},
					],
					components: [],
				});
				return yield* comp.loadTree(entityId, "icalendar");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		const root = Option.getOrThrow(result);
		const v = root.properties[0]?.value;
		expect(v?.type).toBe("DATE");
		if (v?.type === "DATE") {
			expect(Temporal.PlainDate.compare(v.value, date)).toBe(0);
		}
	});

	it("round-trips DATE_TIME (ZonedDateTime UTC) value", async () => {
		const zdt = Temporal.Instant.from(
			"2026-04-04T14:00:00Z",
		).toZonedDateTimeISO("UTC");
		const result = await runSuccess(
			Effect.gen(function* () {
				const entity = yield* makeEntity();
				const entityId = EntityId(entity.id);
				const comp = yield* ComponentRepository;
				yield* comp.insertTree(entityId, {
					name: "VCALENDAR",
					properties: [
						{
							name: "DTSTAMP",
							parameters: [],
							value: { type: "DATE_TIME", value: zdt },
							isKnown: true,
						},
					],
					components: [],
				});
				return yield* comp.loadTree(entityId, "icalendar");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		const root = Option.getOrThrow(result);
		const v = root.properties[0]?.value;
		expect(v?.type).toBe("DATE_TIME");
		if (v?.type === "DATE_TIME") {
			expect(Temporal.ZonedDateTime.compare(v.value, zdt)).toBe(0);
		}
	});

	it("round-trips DATE_TIME (ZonedDateTime with TZID) value", async () => {
		const zdt = Temporal.ZonedDateTime.from(
			"2026-04-04T09:00:00[America/New_York]",
		);
		const result = await runSuccess(
			Effect.gen(function* () {
				const entity = yield* makeEntity();
				const entityId = EntityId(entity.id);
				const comp = yield* ComponentRepository;
				yield* comp.insertTree(entityId, {
					name: "VCALENDAR",
					properties: [
						{
							name: "DTSTART",
							parameters: [{ name: "TZID", value: "America/New_York" }],
							value: { type: "DATE_TIME", value: zdt },
							isKnown: true,
						},
					],
					components: [],
				});
				return yield* comp.loadTree(entityId, "icalendar");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		const root = Option.getOrThrow(result);
		const v = root.properties[0]?.value;
		expect(v?.type).toBe("DATE_TIME");
		if (v?.type === "DATE_TIME") {
			expect(v.value.timeZoneId).toBe("America/New_York");
			expect(Temporal.ZonedDateTime.compare(v.value, zdt)).toBe(0);
		}
	});

	it("round-trips TEXT_LIST value", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const entity = yield* makeEntity();
				const entityId = EntityId(entity.id);
				const comp = yield* ComponentRepository;
				yield* comp.insertTree(entityId, {
					name: "VCALENDAR",
					properties: [
						{
							name: "CATEGORIES",
							parameters: [],
							value: { type: "TEXT_LIST", value: ["WORK", "MEETING", "TEAM"] },
							isKnown: true,
						},
					],
					components: [],
				});
				return yield* comp.loadTree(entityId, "icalendar");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		const root = Option.getOrThrow(result);
		const v = root.properties[0]?.value;
		expect(v?.type).toBe("TEXT_LIST");
		if (v?.type === "TEXT_LIST") {
			expect(v.value).toEqual(["WORK", "MEETING", "TEAM"]);
		}
	});

	it("round-trips RECUR value", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const entity = yield* makeEntity();
				const entityId = EntityId(entity.id);
				const comp = yield* ComponentRepository;
				yield* comp.insertTree(entityId, {
					name: "VCALENDAR",
					properties: [
						{
							name: "RRULE",
							parameters: [],
							value: { type: "RECUR", value: "FREQ=WEEKLY;BYDAY=MO,WE,FR" },
							isKnown: true,
						},
					],
					components: [],
				});
				return yield* comp.loadTree(entityId, "icalendar");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		const root = Option.getOrThrow(result);
		const v = root.properties[0]?.value;
		expect(v?.type).toBe("RECUR");
		if (v?.type === "RECUR") {
			expect(v.value).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
		}
	});
});

// ---------------------------------------------------------------------------
// isKnown round-trips
// ---------------------------------------------------------------------------

describe("ComponentRepository isKnown round-trips (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("preserves isKnown: false for X- prefixed properties", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const entity = yield* makeEntity();
				const entityId = EntityId(entity.id);
				const comp = yield* ComponentRepository;
				yield* comp.insertTree(entityId, {
					name: "VCALENDAR",
					properties: [
						{
							name: "X-CUSTOM-COLOR",
							parameters: [],
							value: { type: "TEXT", value: "#ff0000" },
							isKnown: false,
						},
					],
					components: [],
				});
				return yield* comp.loadTree(entityId, "icalendar");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		const root = Option.getOrThrow(result);
		expect(root.properties[0]?.isKnown).toBe(false);
	});

	it("preserves isKnown: false for unrecognized IANA properties", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const entity = yield* makeEntity();
				const entityId = EntityId(entity.id);
				const comp = yield* ComponentRepository;
				yield* comp.insertTree(entityId, {
					name: "VCALENDAR",
					properties: [
						{
							name: "UNRECOGNIZED-PROP",
							parameters: [],
							value: { type: "TEXT", value: "some-value" },
							isKnown: false,
						},
					],
					components: [],
				});
				return yield* comp.loadTree(entityId, "icalendar");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		const root = Option.getOrThrow(result);
		expect(root.properties[0]?.isKnown).toBe(false);
	});

	it("returns isKnown: true for known iCalendar properties", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const entity = yield* makeEntity();
				const entityId = EntityId(entity.id);
				const comp = yield* ComponentRepository;
				yield* comp.insertTree(entityId, {
					name: "VCALENDAR",
					properties: [
						{
							name: "SUMMARY",
							parameters: [],
							value: { type: "TEXT", value: "known" },
							isKnown: true,
						},
					],
					components: [],
				});
				return yield* comp.loadTree(entityId, "icalendar");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		const root = Option.getOrThrow(result);
		expect(root.properties[0]?.isKnown).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Ordinal and structural invariants
// ---------------------------------------------------------------------------

describe("ComponentRepository ordinal and structural invariants (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("preserves property insertion order", async () => {
		const names = ["PRODID", "VERSION", "CALSCALE", "METHOD"];
		const result = await runSuccess(
			Effect.gen(function* () {
				const entity = yield* makeEntity();
				const entityId = EntityId(entity.id);
				const comp = yield* ComponentRepository;
				yield* comp.insertTree(entityId, {
					name: "VCALENDAR",
					properties: names.map((name) => ({
						name,
						parameters: [],
						value: { type: "TEXT" as const, value: "x" },
						isKnown: true,
					})),
					components: [],
				});
				return yield* comp.loadTree(entityId, "icalendar");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		const root = Option.getOrThrow(result);
		expect(root.properties.map((p) => p.name)).toEqual(names);
	});

	it("preserves sub-component insertion order", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const entity = yield* makeEntity();
				const entityId = EntityId(entity.id);
				const comp = yield* ComponentRepository;
				yield* comp.insertTree(entityId, {
					name: "VCALENDAR",
					properties: [],
					components: [
						{
							name: "VEVENT",
							properties: [
								{
									name: "SUMMARY",
									parameters: [],
									value: { type: "TEXT", value: "first" },
									isKnown: true,
								},
							],
							components: [],
						},
						{
							name: "VEVENT",
							properties: [
								{
									name: "SUMMARY",
									parameters: [],
									value: { type: "TEXT", value: "second" },
									isKnown: true,
								},
							],
							components: [],
						},
					],
				});
				return yield* comp.loadTree(entityId, "icalendar");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		const root = Option.getOrThrow(result);
		expect(root.components).toHaveLength(2);
		expect(root.components[0]?.properties[0]?.value).toEqual({
			type: "TEXT",
			value: "first",
		});
		expect(root.components[1]?.properties[0]?.value).toEqual({
			type: "TEXT",
			value: "second",
		});
	});

	it("round-trips a component with no properties and no sub-components", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const entity = yield* makeEntity();
				const entityId = EntityId(entity.id);
				const comp = yield* ComponentRepository;
				yield* comp.insertTree(entityId, {
					name: "VCALENDAR",
					properties: [],
					components: [],
				});
				return yield* comp.loadTree(entityId, "icalendar");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		const root = Option.getOrThrow(result);
		expect(root.name).toBe("VCALENDAR");
		expect(root.properties).toHaveLength(0);
		expect(root.components).toHaveLength(0);
	});

	it("preserves parameter insertion order", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const entity = yield* makeEntity();
				const entityId = EntityId(entity.id);
				const comp = yield* ComponentRepository;
				yield* comp.insertTree(entityId, {
					name: "VCALENDAR",
					properties: [
						{
							name: "DTSTART",
							parameters: [
								{ name: "TZID", value: "America/New_York" },
								{ name: "VALUE", value: "DATE-TIME" },
							],
							value: {
								type: "DATE_TIME",
								value: Temporal.ZonedDateTime.from(
									"2026-04-04T09:00:00[America/New_York]",
								),
							},
							isKnown: true,
						},
					],
					components: [],
				});
				return yield* comp.loadTree(entityId, "icalendar");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		const root = Option.getOrThrow(result);
		const params = root.properties[0]?.parameters ?? [];
		expect(params).toHaveLength(2);
		expect(params[0]?.name).toBe("TZID");
		expect(params[1]?.name).toBe("VALUE");
	});
});
