import { beforeAll, describe, expect, it } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { EntityId } from "#src/domain/ids.ts";
import { runSuccess } from "#src/testing/effect.ts";
import { makePgliteDatabaseLayer } from "#src/testing/pglite.ts";
import { EntityRepositoryLive } from "./repository.live.ts";
import { EntityRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// Integration tests for EntityRepositoryLive
//
// dav_entity has no FK to any other table, so no auxiliary repository is needed.
// Each describe block shares one PGlite instance for round-trip assertions;
// blocks are isolated from each other.
// ---------------------------------------------------------------------------

type TestLayer = Layer.Layer<EntityRepository, Error>;

function makeTestLayer(): TestLayer {
	return EntityRepositoryLive.pipe(Layer.provide(makePgliteDatabaseLayer()));
}

// ---------------------------------------------------------------------------
// insert
// ---------------------------------------------------------------------------

describe("EntityRepository.insert (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("creates a row with the correct entityType and logicalUid: null", async () => {
		const result = await runSuccess(
			EntityRepository.pipe(
				Effect.flatMap((r) =>
					r.insert({ entityType: "icalendar", logicalUid: null }),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(result.entityType).toBe("icalendar");
		expect(result.logicalUid).toBeNull();
		expect(result.id).toBeString();
		expect(result.deletedAt).toBeNull();
	});

	it("persists a non-null logicalUid", async () => {
		const result = await runSuccess(
			EntityRepository.pipe(
				Effect.flatMap((r) =>
					r.insert({ entityType: "vcard", logicalUid: "urn:uuid:abc-123" }),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(result.entityType).toBe("vcard");
		expect(result.logicalUid).toBe("urn:uuid:abc-123");
	});
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe("EntityRepository.findById (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("returns Some for an active entity", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const repo = yield* EntityRepository;
				const inserted = yield* repo.insert({
					entityType: "icalendar",
					logicalUid: null,
				});
				return yield* repo.findById(EntityId(inserted.id));
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isSome(result)).toBe(true);
	});

	it("returns None for an unknown id", async () => {
		const result = await runSuccess(
			EntityRepository.pipe(
				Effect.flatMap((r) =>
					r.findById(EntityId(crypto.randomUUID())),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(Option.isNone(result)).toBe(true);
	});

	it("returns None after softDelete", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const repo = yield* EntityRepository;
				const inserted = yield* repo.insert({
					entityType: "vcard",
					logicalUid: null,
				});
				const id = EntityId(inserted.id);
				yield* repo.softDelete(id);
				return yield* repo.findById(id);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isNone(result)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// updateLogicalUid
// ---------------------------------------------------------------------------

describe("EntityRepository.updateLogicalUid (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("changes the logicalUid; subsequent findById reflects the new value", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const repo = yield* EntityRepository;
				const inserted = yield* repo.insert({
					entityType: "icalendar",
					logicalUid: null,
				});
				const id = EntityId(inserted.id);
				yield* repo.updateLogicalUid(id, "new-uid-value");
				return yield* repo.findById(id);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isSome(result)).toBe(true);
		expect(Option.getOrThrow(result).logicalUid).toBe("new-uid-value");
	});

	it("accepts null to clear the uid", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const repo = yield* EntityRepository;
				const inserted = yield* repo.insert({
					entityType: "icalendar",
					logicalUid: "to-be-cleared",
				});
				const id = EntityId(inserted.id);
				yield* repo.updateLogicalUid(id, null);
				return yield* repo.findById(id);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isSome(result)).toBe(true);
		expect(Option.getOrThrow(result).logicalUid).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// softDelete
// ---------------------------------------------------------------------------

describe("EntityRepository.softDelete (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("marks deletedAt; entity is no longer visible via findById", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const repo = yield* EntityRepository;
				const inserted = yield* repo.insert({
					entityType: "icalendar",
					logicalUid: null,
				});
				const id = EntityId(inserted.id);
				yield* repo.softDelete(id);
				return yield* repo.findById(id);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isNone(result)).toBe(true);
	});
});
