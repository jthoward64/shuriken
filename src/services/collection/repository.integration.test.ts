import { beforeAll, describe, expect, it } from "bun:test";
import { Effect, Layer, Option } from "effect";
import type { DatabaseError } from "#src/domain/errors.ts";
import { CollectionId, PrincipalId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { UserRepositoryLive } from "#src/services/user/repository.live.ts";
import { UserRepository } from "#src/services/user/repository.ts";
import { runFailure, runSuccess } from "#src/testing/effect.ts";
import { makePgliteDatabaseLayer } from "#src/testing/pglite.ts";
import { CollectionRepositoryLive } from "./repository.live.ts";
import { CollectionRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// Integration tests for CollectionRepositoryLive
//
// Each describe block creates its own PGlite instance so tests within a block
// can share state for round-trip assertions while blocks are isolated.
//
// dav_collection has a FK to principal, so every test that inserts a
// collection must first create a user (which inserts a principal row).
// We use UserRepository.create() for that — keeping it purely in-DB.
// ---------------------------------------------------------------------------

type TestLayer = Layer.Layer<CollectionRepository | UserRepository, Error>;

function makeTestLayer(): TestLayer {
	const db = makePgliteDatabaseLayer();
	return Layer.mergeAll(
		CollectionRepositoryLive.pipe(Layer.provide(db)),
		UserRepositoryLive.pipe(Layer.provide(db)),
	);
}

// ---------------------------------------------------------------------------
// findBySlug
// ---------------------------------------------------------------------------

describe("CollectionRepository.findBySlug (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("returns None for an unknown slug on an empty table", async () => {
		const ownerId = PrincipalId(crypto.randomUUID());
		const result = await runSuccess(
			CollectionRepository.pipe(
				Effect.flatMap((r) => r.findBySlug(ownerId, Slug("no-such-calendar"))),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(Option.isNone(result)).toBe(true);
	});

	it("insert then findBySlug returns the same row", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const user = yield* UserRepository;
				const col = yield* CollectionRepository;

				const { principal } = yield* user.create({
					slug: Slug("alice"),
					name: "Alice",
					email: Email("alice@example.com"),
					credentials: [],
				});
				const inserted = yield* col.insert({
					ownerPrincipalId: PrincipalId(principal.id),
					collectionType: "calendar",
					slug: Slug("my-calendar"),
					displayName: "My Calendar",
				});
				const found = yield* col.findBySlug(PrincipalId(principal.id), Slug("my-calendar"));
				return { inserted, found };
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isSome(result.found)).toBe(true);
		const found = Option.getOrThrow(result.found);
		expect(found.id).toBe(result.inserted.id);
		expect(found.slug).toBe("my-calendar");
		expect(found.displayName).toBe("My Calendar");
		expect(found.collectionType).toBe("calendar");
	});

	it("findBySlug is scoped to owner — same slug under a different owner returns None", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const user = yield* UserRepository;
				const col = yield* CollectionRepository;

				const { principal: p1 } = yield* user.create({
					slug: Slug("bob"),
					name: "Bob",
					email: Email("bob@example.com"),
					credentials: [],
				});
				const { principal: p2 } = yield* user.create({
					slug: Slug("carol"),
					name: "Carol",
					email: Email("carol@example.com"),
					credentials: [],
				});

				yield* col.insert({
					ownerPrincipalId: PrincipalId(p1.id),
					collectionType: "calendar",
					slug: Slug("shared-slug"),
				});
				return yield* col.findBySlug(PrincipalId(p2.id), Slug("shared-slug"));
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isNone(result)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// listByOwner
// ---------------------------------------------------------------------------

describe("CollectionRepository.listByOwner (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("returns an empty list when the owner has no collections", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const user = yield* UserRepository;
				const col = yield* CollectionRepository;
				const { principal } = yield* user.create({
					slug: Slug("empty-owner"),
					name: "Empty",
					email: Email("empty@example.com"),
					credentials: [],
				});
				return yield* col.listByOwner(PrincipalId(principal.id));
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(result).toHaveLength(0);
	});

	it("returns all active collections for an owner", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const user = yield* UserRepository;
				const col = yield* CollectionRepository;
				const { principal } = yield* user.create({
					slug: Slug("multi-owner"),
					name: "Multi",
					email: Email("multi@example.com"),
					credentials: [],
				});
				const ownerId = PrincipalId(principal.id);
				yield* col.insert({ ownerPrincipalId: ownerId, collectionType: "calendar", slug: Slug("cal-a") });
				yield* col.insert({ ownerPrincipalId: ownerId, collectionType: "addressbook", slug: Slug("ab-b") });
				return yield* col.listByOwner(ownerId);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(result).toHaveLength(2);
		const slugs = [...result].map((c) => c.slug).sort();
		expect(slugs).toEqual(["ab-b", "cal-a"]);
	});

	it("excludes soft-deleted collections from listByOwner", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const user = yield* UserRepository;
				const col = yield* CollectionRepository;
				const { principal } = yield* user.create({
					slug: Slug("del-owner"),
					name: "Del",
					email: Email("del@example.com"),
					credentials: [],
				});
				const ownerId = PrincipalId(principal.id);
				const kept = yield* col.insert({ ownerPrincipalId: ownerId, collectionType: "calendar", slug: Slug("kept") });
				const deleted = yield* col.insert({ ownerPrincipalId: ownerId, collectionType: "calendar", slug: Slug("deleted") });
				yield* col.softDelete(CollectionId(deleted.id));
				const list = yield* col.listByOwner(ownerId);
				return { kept, list };
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(result.list).toHaveLength(1);
		expect(result.list[0]?.id).toBe(result.kept.id);
	});
});

// ---------------------------------------------------------------------------
// Unique slug per owner constraint
// ---------------------------------------------------------------------------

describe("CollectionRepository unique slug constraint (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("inserting two collections with the same owner + slug fails with DatabaseError", async () => {
		const err = await runFailure(
			Effect.gen(function* () {
				const user = yield* UserRepository;
				const col = yield* CollectionRepository;
				const { principal } = yield* user.create({
					slug: Slug("dup-owner"),
					name: "Dup",
					email: Email("dup@example.com"),
					credentials: [],
				});
				const ownerId = PrincipalId(principal.id);
				yield* col.insert({ ownerPrincipalId: ownerId, collectionType: "calendar", slug: Slug("duplicate") });
				yield* col.insert({ ownerPrincipalId: ownerId, collectionType: "calendar", slug: Slug("duplicate") });
			}).pipe(Effect.provide(layer)),
		) as DatabaseError;

		expect(err._tag).toBe("DatabaseError");
	});
});

// ---------------------------------------------------------------------------
// softDelete / findById
// ---------------------------------------------------------------------------

describe("CollectionRepository.softDelete (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("findById returns the collection before soft delete", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const user = yield* UserRepository;
				const col = yield* CollectionRepository;
				const { principal } = yield* user.create({
					slug: Slug("pre-del"),
					name: "PreDel",
					email: Email("predel@example.com"),
					credentials: [],
				});
				const inserted = yield* col.insert({
					ownerPrincipalId: PrincipalId(principal.id),
					collectionType: "calendar",
					slug: Slug("active"),
				});
				return yield* col.findById(CollectionId(inserted.id));
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(Option.isSome(result)).toBe(true);
	});

	it("findById returns None after soft delete", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const user = yield* UserRepository;
				const col = yield* CollectionRepository;
				const { principal } = yield* user.create({
					slug: Slug("post-del"),
					name: "PostDel",
					email: Email("postdel@example.com"),
					credentials: [],
				});
				const inserted = yield* col.insert({
					ownerPrincipalId: PrincipalId(principal.id),
					collectionType: "addressbook",
					slug: Slug("contacts"),
				});
				const id = CollectionId(inserted.id);
				yield* col.softDelete(id);
				return yield* col.findById(id);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(Option.isNone(result)).toBe(true);
	});

	it("findBySlug returns None after soft delete", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const user = yield* UserRepository;
				const col = yield* CollectionRepository;
				const { principal } = yield* user.create({
					slug: Slug("gone-owner"),
					name: "Gone",
					email: Email("gone@example.com"),
					credentials: [],
				});
				const ownerId = PrincipalId(principal.id);
				const inserted = yield* col.insert({
					ownerPrincipalId: ownerId,
					collectionType: "calendar",
					slug: Slug("gone"),
				});
				yield* col.softDelete(CollectionId(inserted.id));
				return yield* col.findBySlug(ownerId, Slug("gone"));
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(Option.isNone(result)).toBe(true);
	});
});
