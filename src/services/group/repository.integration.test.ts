import { beforeAll, describe, expect, it } from "bun:test";
import { Effect, Layer, Option } from "effect";
import type { ConflictError } from "#src/domain/errors.ts";
import { GroupId, UserId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { UserRepositoryLive } from "#src/services/user/repository.live.ts";
import { UserRepository } from "#src/services/user/repository.ts";
import { runFailure, runSuccess } from "#src/testing/effect.ts";
import { makePgliteDatabaseLayer } from "#src/testing/pglite.ts";
import { GroupRepositoryLive } from "./repository.live.ts";
import { GroupRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// Integration tests for GroupRepositoryLive
//
// Each describe block gets a fresh PGlite instance so tests within a block
// share state, while blocks are fully isolated from each other.
//
// Groups share the principal table with users, so UserRepository is included
// in every test layer to allow creating user members.
// ---------------------------------------------------------------------------

type TestLayer = Layer.Layer<GroupRepository | UserRepository, Error>;

function makeTestLayer(): TestLayer {
	const db = makePgliteDatabaseLayer();
	return Layer.mergeAll(
		GroupRepositoryLive.pipe(Layer.provide(db)),
		UserRepositoryLive.pipe(Layer.provide(db)),
	);
}

// ---------------------------------------------------------------------------
// create → findById round-trip
// ---------------------------------------------------------------------------

describe("GroupRepository.create (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("create then findById returns the same row", async () => {
		const result = await runSuccess(
			GroupRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						const created = yield* r.create({ slug: Slug("eng") });
						const found = yield* r.findById(GroupId(created.group.id));
						return { created, found };
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(Option.isSome(result.found)).toBe(true);
		const found = Option.getOrThrow(result.found);
		expect(found.group.id).toBe(result.created.group.id);
		expect(found.principal.slug).toBe("eng");
		expect(found.principal.principalType).toBe("group");
	});

	it("create with displayName stores it on the principal row", async () => {
		const result = await runSuccess(
			GroupRepository.pipe(
				Effect.flatMap((r) =>
					r.create({ slug: Slug("design"), displayName: "Design Team" }),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(result.principal.displayName).toBe("Design Team");
	});

	it("findById returns None for an unknown id", async () => {
		const result = await runSuccess(
			GroupRepository.pipe(
				Effect.flatMap((r) => r.findById(GroupId(crypto.randomUUID()))),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(Option.isNone(result)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe("GroupRepository.update (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("update persists displayName on the principal", async () => {
		const result = await runSuccess(
			GroupRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						const created = yield* r.create({ slug: Slug("ops") });
						return yield* r.update(GroupId(created.group.id), {
							displayName: "Operations",
						});
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(result.principal.displayName).toBe("Operations");
		expect(result.principal.slug).toBe("ops");
	});
});

// ---------------------------------------------------------------------------
// addMember / hasMember / removeMember
// ---------------------------------------------------------------------------

describe("GroupRepository membership (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("hasMember returns false when user is not in the group", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const groupRepo = yield* GroupRepository;
				const { user } = yield* userRepo.create({
					slug: Slug("alice"),
					displayName: "Alice",
					email: Email("alice@example.com"),
					credentials: [],
				});
				const { group } = yield* groupRepo.create({ slug: Slug("team") });
				return yield* groupRepo.hasMember(GroupId(group.id), UserId(user.id));
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(result).toBe(false);
	});

	it("addMember then hasMember returns true", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const groupRepo = yield* GroupRepository;
				const { user } = yield* userRepo.create({
					slug: Slug("bob"),
					displayName: "Bob",
					email: Email("bob@example.com"),
					credentials: [],
				});
				const { group } = yield* groupRepo.create({ slug: Slug("devs") });
				const groupId = GroupId(group.id);
				const userId = UserId(user.id);
				yield* groupRepo.addMember(groupId, userId);
				return yield* groupRepo.hasMember(groupId, userId);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(result).toBe(true);
	});

	it("removeMember after addMember results in hasMember = false", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const groupRepo = yield* GroupRepository;
				const { user } = yield* userRepo.create({
					slug: Slug("carol"),
					displayName: "Carol",
					email: Email("carol@example.com"),
					credentials: [],
				});
				const { group } = yield* groupRepo.create({ slug: Slug("temps") });
				const groupId = GroupId(group.id);
				const userId = UserId(user.id);
				yield* groupRepo.addMember(groupId, userId);
				yield* groupRepo.removeMember(groupId, userId);
				return yield* groupRepo.hasMember(groupId, userId);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(result).toBe(false);
	});

	it("addMember is idempotent (no error on duplicate add)", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const groupRepo = yield* GroupRepository;
				const { user } = yield* userRepo.create({
					slug: Slug("dave"),
					displayName: "Dave",
					email: Email("dave@example.com"),
					credentials: [],
				});
				const { group } = yield* groupRepo.create({ slug: Slug("both") });
				const groupId = GroupId(group.id);
				const userId = UserId(user.id);
				yield* groupRepo.addMember(groupId, userId);
				yield* groupRepo.addMember(groupId, userId); // second add must not throw
				return yield* groupRepo.hasMember(groupId, userId);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(result).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Unique slug constraint → ConflictError
// ---------------------------------------------------------------------------

describe("GroupRepository unique slug constraint (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("two groups with the same slug fails with ConflictError", async () => {
		const err = (await runFailure(
			GroupRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						yield* r.create({ slug: Slug("dup-group") });
						yield* r.create({ slug: Slug("dup-group") });
					}),
				),
				Effect.provide(layer),
			),
		)) as ConflictError;

		expect(err._tag).toBe("ConflictError");
		expect(err.field).toBe("slug");
	});
});
