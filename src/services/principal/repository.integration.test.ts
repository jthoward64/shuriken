import { beforeAll, describe, expect, it } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { PrincipalId, UserId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { UserRepositoryLive } from "#src/services/user/repository.live.ts";
import { UserRepository } from "#src/services/user/repository.ts";
import { runSuccess } from "#src/testing/effect.ts";
import { makePgliteDatabaseLayer } from "#src/testing/pglite.ts";
import { PrincipalRepositoryLive } from "./repository.live.ts";
import { PrincipalRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// Integration tests for PrincipalRepositoryLive
//
// PrincipalRepository provides read-only views over the principal + user join.
// UserRepository.create() is the write path; we depend on it for all setup.
// ---------------------------------------------------------------------------

type TestLayer = Layer.Layer<PrincipalRepository | UserRepository, Error>;

function makeTestLayer(): TestLayer {
	const db = makePgliteDatabaseLayer();
	return Layer.mergeAll(
		PrincipalRepositoryLive.pipe(Layer.provide(db)),
		UserRepositoryLive.pipe(Layer.provide(db)),
	);
}

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe("PrincipalRepository.findById (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("returns None for an unknown id", async () => {
		const result = await runSuccess(
			PrincipalRepository.pipe(
				Effect.flatMap((r) => r.findById(PrincipalId(crypto.randomUUID()))),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(Option.isNone(result)).toBe(true);
	});

	it("create then findById returns the principal and user", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const principalRepo = yield* PrincipalRepository;
				const { principal, user } = yield* userRepo.create({
					slug: Slug("alice"),
					name: "Alice",
					email: Email("alice@example.com"),
					credentials: [],
				});
				const found = yield* principalRepo.findById(
					PrincipalId(principal.id),
				);
				return { user, found };
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isSome(result.found)).toBe(true);
		const found = Option.getOrThrow(result.found);
		expect(found.user.id).toBe(result.user.id);
		expect(found.user.email).toBe("alice@example.com");
		expect(found.principal.slug).toBe("alice");
		expect(found.principal.principalType).toBe("user");
	});
});

// ---------------------------------------------------------------------------
// findBySlug
// ---------------------------------------------------------------------------

describe("PrincipalRepository.findBySlug (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("returns None for an unknown slug", async () => {
		const result = await runSuccess(
			PrincipalRepository.pipe(
				Effect.flatMap((r) => r.findBySlug(Slug("nobody"))),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(Option.isNone(result)).toBe(true);
	});

	it("create then findBySlug returns the correct row", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const principalRepo = yield* PrincipalRepository;
				yield* userRepo.create({
					slug: Slug("bob"),
					name: "Bob",
					email: Email("bob@example.com"),
					credentials: [],
				});
				return yield* principalRepo.findBySlug(Slug("bob"));
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isSome(result)).toBe(true);
		const found = Option.getOrThrow(result);
		expect(found.principal.slug).toBe("bob");
		expect(found.user.email).toBe("bob@example.com");
	});
});

// ---------------------------------------------------------------------------
// findByEmail
// ---------------------------------------------------------------------------

describe("PrincipalRepository.findByEmail (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("returns None for an unknown email", async () => {
		const result = await runSuccess(
			PrincipalRepository.pipe(
				Effect.flatMap((r) => r.findByEmail(Email("nobody@example.com"))),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(Option.isNone(result)).toBe(true);
	});

	it("create then findByEmail returns the correct row", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const principalRepo = yield* PrincipalRepository;
				yield* userRepo.create({
					slug: Slug("carol"),
					name: "Carol",
					email: Email("carol@example.com"),
					credentials: [],
				});
				return yield* principalRepo.findByEmail(Email("carol@example.com"));
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isSome(result)).toBe(true);
		const found = Option.getOrThrow(result);
		expect(found.user.email).toBe("carol@example.com");
		expect(found.principal.slug).toBe("carol");
	});
});

// ---------------------------------------------------------------------------
// findUserByUserId
// ---------------------------------------------------------------------------

describe("PrincipalRepository.findUserByUserId (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("returns None for an unknown user id", async () => {
		const result = await runSuccess(
			PrincipalRepository.pipe(
				Effect.flatMap((r) => r.findUserByUserId(UserId(crypto.randomUUID()))),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(Option.isNone(result)).toBe(true);
	});

	it("create then findUserByUserId returns the user row", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const principalRepo = yield* PrincipalRepository;
				const { user } = yield* userRepo.create({
					slug: Slug("dave"),
					name: "Dave",
					email: Email("dave@example.com"),
					credentials: [],
				});
				return yield* principalRepo.findUserByUserId(UserId(user.id));
			}).pipe(Effect.provide(layer), Effect.orDie),
		);

		expect(Option.isSome(result)).toBe(true);
		const found = Option.getOrThrow(result);
		expect(found.email).toBe("dave@example.com");
		expect(found.name).toBe("Dave");
	});
});
