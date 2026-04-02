import { beforeAll, describe, expect, it } from "bun:test";
import { Effect, Layer, Option, Redacted } from "effect";
import { UserId } from "#src/domain/ids.ts";
import { Email } from "#src/domain/types/strings.ts";
import { Slug } from "#src/domain/types/path.ts";
import { makePgliteDatabaseLayer } from "#src/testing/pglite.ts";
import { runSuccess } from "#src/testing/effect.ts";
import { UserRepository } from "./repository.ts";
import { UserRepositoryLive } from "./repository.live.ts";

// ---------------------------------------------------------------------------
// Integration tests for UserRepositoryLive
//
// Each describe block gets a fresh PGlite instance via beforeAll so that tests
// within a block share state (making round-trip tests possible), while blocks
// are fully isolated from each other.
// ---------------------------------------------------------------------------

type TestLayer = Layer.Layer<UserRepository, Error>;

function makeTestLayer(): TestLayer {
	return UserRepositoryLive.pipe(Layer.provide(makePgliteDatabaseLayer()));
}

// ---------------------------------------------------------------------------
// findByEmail
// ---------------------------------------------------------------------------

describe("UserRepository.findByEmail (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("returns None for an unknown email on an empty table", async () => {
		const result = await runSuccess(
			UserRepository.pipe(
				Effect.flatMap((r) => r.findByEmail(Email("nobody@example.com"))),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(Option.isNone(result)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// create → findByEmail / findById round-trips
// ---------------------------------------------------------------------------

describe("UserRepository.create (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("create then findByEmail returns the same row", async () => {
		const result = await runSuccess(
			UserRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						const created = yield* r.create({
							slug: Slug("alice"),
							name: "Alice",
							email: Email("alice@example.com"),
							credentials: [],
						});
						const found = yield* r.findByEmail(Email("alice@example.com"));
						return { created, found };
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(Option.isSome(result.found)).toBe(true);
		const found = Option.getOrThrow(result.found);
		expect(found.user.id).toBe(result.created.user.id);
		expect(found.user.email).toBe("alice@example.com");
		expect(found.user.name).toBe("Alice");
		expect(found.principal.slug).toBe("alice");
		expect(found.principal.principalType).toBe("user");
	});

	it("create then findById returns the same row", async () => {
		const result = await runSuccess(
			UserRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						const created = yield* r.create({
							slug: Slug("bob"),
							name: "Bob",
							email: Email("bob@example.com"),
							credentials: [],
						});
						const found = yield* r.findById(UserId(created.user.id));
						return { created, found };
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(Option.isSome(result.found)).toBe(true);
		const found = Option.getOrThrow(result.found);
		expect(found.user.id).toBe(result.created.user.id);
		expect(found.principal.id).toBe(result.created.principal.id);
	});

	it("create stores credentials in the auth_user table", async () => {
		const result = await runSuccess(
			UserRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						yield* r.create({
							slug: Slug("carol"),
							name: "Carol",
							email: Email("carol@example.com"),
							credentials: [
								{
									authSource: "local",
									authId: "carol-local",
									authCredential: Option.some(Redacted.make("hashed-secret")),
								},
							],
						});
						return yield* r.findCredential("local", "carol-local");
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(Option.isSome(result)).toBe(true);
		const cred = Option.getOrThrow(result);
		expect(cred.authSource).toBe("local");
		expect(cred.authId).toBe("carol-local");
		expect(Redacted.value(cred.authCredential ?? Redacted.make(""))).toBe("hashed-secret");
	});
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe("UserRepository.update (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("update persists only the changed fields and leaves others unchanged", async () => {
		const result = await runSuccess(
			UserRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						const created = yield* r.create({
							slug: Slug("alice"),
							name: "Alice",
							email: Email("alice@example.com"),
							credentials: [],
						});
						return yield* r.update(UserId(created.user.id), { name: "Alice Smith" });
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(result.user.name).toBe("Alice Smith");
		// email was not in the update payload — must be unchanged
		expect(result.user.email).toBe("alice@example.com");
	});

	it("update displayName patches the principal row", async () => {
		const result = await runSuccess(
			UserRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						const created = yield* r.create({
							slug: Slug("bob"),
							name: "Bob",
							email: Email("bob@example.com"),
							credentials: [],
						});
						return yield* r.update(UserId(created.user.id), { displayName: "Robert" });
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(result.principal.displayName).toBe("Robert");
	});
});

// ---------------------------------------------------------------------------
// Soft delete
// ---------------------------------------------------------------------------

describe("UserRepository soft delete (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("findById returns the user when the principal is not deleted", async () => {
		const result = await runSuccess(
			UserRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						const created = yield* r.create({
							slug: Slug("ghost"),
							name: "Ghost",
							email: Email("ghost@example.com"),
							credentials: [],
						});
						return yield* r.findById(UserId(created.user.id));
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(Option.isSome(result)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Credential lifecycle: findCredential / insertCredential / deleteCredential
// ---------------------------------------------------------------------------

describe("UserRepository credential lifecycle (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("findCredential returns None for an unknown credential", async () => {
		const result = await runSuccess(
			UserRepository.pipe(
				Effect.flatMap((r) => r.findCredential("local", "nobody")),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(Option.isNone(result)).toBe(true);
	});

	it("insertCredential then findCredential returns the credential", async () => {
		const result = await runSuccess(
			UserRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						const created = yield* r.create({
							slug: Slug("alice"),
							name: "Alice",
							email: Email("alice@example.com"),
							credentials: [],
						});
						yield* r.insertCredential({
							userId: UserId(created.user.id),
							authSource: "local",
							authId: "alice-local",
							authCredential: Option.some(Redacted.make("secret")),
						});
						return yield* r.findCredential("local", "alice-local");
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(Option.isSome(result)).toBe(true);
		const cred = Option.getOrThrow(result);
		expect(cred.authSource).toBe("local");
		expect(cred.authId).toBe("alice-local");
	});

	it("deleteCredential removes the credential; subsequent findCredential returns None", async () => {
		const result = await runSuccess(
			UserRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						const created = yield* r.create({
							slug: Slug("bob"),
							name: "Bob",
							email: Email("bob@example.com"),
							credentials: [],
						});
						const userId = UserId(created.user.id);

						yield* r.insertCredential({
							userId,
							authSource: "proxy",
							authId: "bob@sso",
							authCredential: Option.none(),
						});

						const before = yield* r.findCredential("proxy", "bob@sso");
						yield* r.deleteCredential(userId, "proxy", "bob@sso");
						const after = yield* r.findCredential("proxy", "bob@sso");

						return { before, after };
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(Option.isSome(result.before)).toBe(true);
		expect(Option.isNone(result.after)).toBe(true);
	});
});
