import { beforeAll, describe, expect, it } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { DatabaseClient } from "#src/db/client.ts";
import { davEntity } from "#src/db/drizzle/schema/index.ts";
import {
	CollectionId,
	EntityId,
	InstanceId,
	PrincipalId,
} from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email, ETag } from "#src/domain/types/strings.ts";
import { CollectionRepositoryLive } from "#src/services/collection/repository.live.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { UserRepositoryLive } from "#src/services/user/repository.live.ts";
import { UserRepository } from "#src/services/user/repository.ts";
import { runSuccess } from "#src/testing/effect.ts";
import { makePgliteDatabaseLayer } from "#src/testing/pglite.ts";
import { InstanceRepositoryLive } from "./repository.live.ts";
import { InstanceRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// Integration tests for InstanceRepositoryLive
//
// Prerequisites for every instance:
//   1. A user  (provides the principal FK for the collection)
//   2. A dav_collection row  (FK on dav_instance.collection_id)
//   3. A dav_entity row      (FK on dav_instance.entity_id)
//      dav_entity has no public repository; inserted directly via DatabaseClient.
// ---------------------------------------------------------------------------

type TestLayer = Layer.Layer<
	InstanceRepository | CollectionRepository | UserRepository | DatabaseClient,
	Error
>;

function makeTestLayer(): TestLayer {
	const db = makePgliteDatabaseLayer();
	return Layer.mergeAll(
		InstanceRepositoryLive.pipe(Layer.provide(db)),
		CollectionRepositoryLive.pipe(Layer.provide(db)),
		UserRepositoryLive.pipe(Layer.provide(db)),
		db,
	);
}

/** Insert a bare dav_entity row and return its UUID. */
const insertEntity = (
	entityType: "icalendar" | "vcard" = "icalendar",
): Effect.Effect<EntityId, never, DatabaseClient> =>
	DatabaseClient.pipe(
		Effect.flatMap((db) =>
			Effect.promise(async () => {
				const rows = await db
					.insert(davEntity)
					.values({ entityType })
					.returning();
				const row = rows[0];
				if (!row) {
					throw new Error("dav_entity insert returned no rows");
				}
				return EntityId(row.id);
			}),
		),
	);

// ---------------------------------------------------------------------------
// insert → findById round-trip
// ---------------------------------------------------------------------------

describe("InstanceRepository.insert and findById (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("findById returns None for an unknown id", async () => {
		const result = await runSuccess(
			InstanceRepository.pipe(
				Effect.flatMap((r) => r.findById(InstanceId(crypto.randomUUID()))),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(Option.isNone(result)).toBe(true);
	});

	it("insert then findById returns the same row", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const colRepo = yield* CollectionRepository;
				const instanceRepo = yield* InstanceRepository;

				const { principal } = yield* userRepo.create({
					slug: Slug("alice"),
					name: "Alice",
					email: Email("alice@example.com"),
					credentials: [],
				});
				const col = yield* colRepo.insert({
					ownerPrincipalId: PrincipalId(principal.id),
					collectionType: "calendar",
					slug: Slug("cal"),
				});
				const entityId = yield* insertEntity("icalendar");

				const inserted = yield* instanceRepo.insert({
					collectionId: CollectionId(col.id),
					entityId,
					contentType: "text/calendar",
					etag: ETag('"abc123"'),
					slug: Slug("event.ics"),
				});
				const found = yield* instanceRepo.findById(InstanceId(inserted.id));
				return { inserted, found };
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isSome(result.found)).toBe(true);
		const found = Option.getOrThrow(result.found);
		expect(found.id).toBe(result.inserted.id);
		expect(found.slug).toBe("event.ics");
		expect(found.contentType).toBe("text/calendar");
		expect(found.etag).toBe('"abc123"');
	});
});

// ---------------------------------------------------------------------------
// findBySlug
// ---------------------------------------------------------------------------

describe("InstanceRepository.findBySlug (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("returns None for an unknown slug", async () => {
		const result = await runSuccess(
			InstanceRepository.pipe(
				Effect.flatMap((r) =>
					r.findBySlug(CollectionId(crypto.randomUUID()), Slug("no-such.ics")),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(Option.isNone(result)).toBe(true);
	});

	it("insert then findBySlug returns the row", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const colRepo = yield* CollectionRepository;
				const instanceRepo = yield* InstanceRepository;

				const { principal } = yield* userRepo.create({
					slug: Slug("bob"),
					name: "Bob",
					email: Email("bob@example.com"),
					credentials: [],
				});
				const col = yield* colRepo.insert({
					ownerPrincipalId: PrincipalId(principal.id),
					collectionType: "calendar",
					slug: Slug("bob-cal"),
				});
				const entityId = yield* insertEntity();
				const collectionId = CollectionId(col.id);

				yield* instanceRepo.insert({
					collectionId,
					entityId,
					contentType: "text/calendar",
					etag: ETag('"e1"'),
					slug: Slug("meeting.ics"),
				});

				return yield* instanceRepo.findBySlug(
					collectionId,
					Slug("meeting.ics"),
				);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isSome(result)).toBe(true);
		expect(Option.getOrThrow(result).slug).toBe("meeting.ics");
	});

	it("findBySlug is scoped to collection — same slug in another collection returns None", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const colRepo = yield* CollectionRepository;
				const instanceRepo = yield* InstanceRepository;

				const { principal: p1 } = yield* userRepo.create({
					slug: Slug("carol"),
					name: "Carol",
					email: Email("carol@example.com"),
					credentials: [],
				});
				const { principal: p2 } = yield* userRepo.create({
					slug: Slug("dave"),
					name: "Dave",
					email: Email("dave@example.com"),
					credentials: [],
				});

				const col1 = yield* colRepo.insert({
					ownerPrincipalId: PrincipalId(p1.id),
					collectionType: "calendar",
					slug: Slug("c1"),
				});
				const col2 = yield* colRepo.insert({
					ownerPrincipalId: PrincipalId(p2.id),
					collectionType: "calendar",
					slug: Slug("c2"),
				});

				const entityId = yield* insertEntity();
				yield* instanceRepo.insert({
					collectionId: CollectionId(col1.id),
					entityId,
					contentType: "text/calendar",
					etag: ETag('"x"'),
					slug: Slug("shared.ics"),
				});

				// Same slug, different collection — must return None
				return yield* instanceRepo.findBySlug(
					CollectionId(col2.id),
					Slug("shared.ics"),
				);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(Option.isNone(result)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// listByCollection
// ---------------------------------------------------------------------------

describe("InstanceRepository.listByCollection (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("returns an empty list for a collection with no instances", async () => {
		const result = await runSuccess(
			InstanceRepository.pipe(
				Effect.flatMap((r) =>
					r.listByCollection(CollectionId(crypto.randomUUID())),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(result).toHaveLength(0);
	});

	it("returns all active instances in the collection", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const colRepo = yield* CollectionRepository;
				const instanceRepo = yield* InstanceRepository;

				const { principal } = yield* userRepo.create({
					slug: Slug("eve"),
					name: "Eve",
					email: Email("eve@example.com"),
					credentials: [],
				});
				const col = yield* colRepo.insert({
					ownerPrincipalId: PrincipalId(principal.id),
					collectionType: "calendar",
					slug: Slug("multi"),
				});
				const collectionId = CollectionId(col.id);

				const e1 = yield* insertEntity();
				const e2 = yield* insertEntity();
				yield* instanceRepo.insert({
					collectionId,
					entityId: e1,
					contentType: "text/calendar",
					etag: ETag('"a"'),
					slug: Slug("a.ics"),
				});
				yield* instanceRepo.insert({
					collectionId,
					entityId: e2,
					contentType: "text/calendar",
					etag: ETag('"b"'),
					slug: Slug("b.ics"),
				});

				return yield* instanceRepo.listByCollection(collectionId);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(result).toHaveLength(2);
		const slugs = [...result].map((i) => i.slug).sort();
		expect(slugs).toEqual(["a.ics", "b.ics"]);
	});

	it("excludes soft-deleted instances from listByCollection", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const colRepo = yield* CollectionRepository;
				const instanceRepo = yield* InstanceRepository;

				const { principal } = yield* userRepo.create({
					slug: Slug("frank"),
					name: "Frank",
					email: Email("frank@example.com"),
					credentials: [],
				});
				const col = yield* colRepo.insert({
					ownerPrincipalId: PrincipalId(principal.id),
					collectionType: "calendar",
					slug: Slug("frank-cal"),
				});
				const collectionId = CollectionId(col.id);

				const e1 = yield* insertEntity();
				const e2 = yield* insertEntity();
				const kept = yield* instanceRepo.insert({
					collectionId,
					entityId: e1,
					contentType: "text/calendar",
					etag: ETag('"k"'),
					slug: Slug("keep.ics"),
				});
				const deleted = yield* instanceRepo.insert({
					collectionId,
					entityId: e2,
					contentType: "text/calendar",
					etag: ETag('"d"'),
					slug: Slug("delete.ics"),
				});

				yield* instanceRepo.softDelete(InstanceId(deleted.id));

				const list = yield* instanceRepo.listByCollection(collectionId);
				return { kept, list };
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(result.list).toHaveLength(1);
		expect(result.list[0]?.id).toBe(result.kept.id);
	});
});

// ---------------------------------------------------------------------------
// updateEtag
// ---------------------------------------------------------------------------

describe("InstanceRepository.updateEtag (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("updateEtag persists the new etag; sync trigger owns syncRevision", async () => {
		const { insertedRevision, found } = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const colRepo = yield* CollectionRepository;
				const instanceRepo = yield* InstanceRepository;

				const { principal } = yield* userRepo.create({
					slug: Slug("grace"),
					name: "Grace",
					email: Email("grace@example.com"),
					credentials: [],
				});
				const col = yield* colRepo.insert({
					ownerPrincipalId: PrincipalId(principal.id),
					collectionType: "calendar",
					slug: Slug("grace-cal"),
				});
				const entityId = yield* insertEntity();
				const inserted = yield* instanceRepo.insert({
					collectionId: CollectionId(col.id),
					entityId,
					contentType: "text/calendar",
					etag: ETag('"v1"'),
					slug: Slug("item.ics"),
				});

				yield* instanceRepo.updateEtag(InstanceId(inserted.id), ETag('"v2"'));
				const found = yield* instanceRepo.findById(InstanceId(inserted.id));
				return { insertedRevision: inserted.syncRevision, found };
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isSome(found)).toBe(true);
		const row = Option.getOrThrow(found);
		expect(row.etag).toBe('"v2"');
		// syncRevision is managed by the DB trigger; it increments on each change
		expect(row.syncRevision).toBeGreaterThan(insertedRevision);
	});
});

// ---------------------------------------------------------------------------
// softDelete
// ---------------------------------------------------------------------------

describe("InstanceRepository.softDelete (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("findById returns None after softDelete", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const colRepo = yield* CollectionRepository;
				const instanceRepo = yield* InstanceRepository;

				const { principal } = yield* userRepo.create({
					slug: Slug("heidi"),
					name: "Heidi",
					email: Email("heidi@example.com"),
					credentials: [],
				});
				const col = yield* colRepo.insert({
					ownerPrincipalId: PrincipalId(principal.id),
					collectionType: "calendar",
					slug: Slug("heidi-cal"),
				});
				const entityId = yield* insertEntity();
				const inserted = yield* instanceRepo.insert({
					collectionId: CollectionId(col.id),
					entityId,
					contentType: "text/calendar",
					etag: ETag('"x"'),
					slug: Slug("gone.ics"),
				});
				const id = InstanceId(inserted.id);
				yield* instanceRepo.softDelete(id);
				return yield* instanceRepo.findById(id);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(Option.isNone(result)).toBe(true);
	});
});
