import { beforeAll, describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { PrincipalId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { UserRepositoryLive } from "#src/services/user/repository.live.ts";
import { UserRepository } from "#src/services/user/repository.ts";
import { runSuccess } from "#src/testing/effect.ts";
import { makePgliteDatabaseLayer } from "#src/testing/pglite.ts";
import { AclRepositoryLive } from "./repository.live.ts";
import { AclRepository } from "./repository.ts";

// ---------------------------------------------------------------------------
// Integration tests for AclRepositoryLive
//
// dav_acl.resource_id is a plain UUID (no FK), so test resources can be
// random UUIDs. dav_acl.principal_id has a FK to principal, so principal-type
// ACEs require a real principal — created via UserRepository.
// ---------------------------------------------------------------------------

type TestLayer = Layer.Layer<AclRepository | UserRepository, Error>;

function makeTestLayer(): TestLayer {
	const db = makePgliteDatabaseLayer();
	return Layer.mergeAll(
		AclRepositoryLive.pipe(Layer.provide(db)),
		UserRepositoryLive.pipe(Layer.provide(db)),
	);
}

// ---------------------------------------------------------------------------
// grantAce / getAces
// ---------------------------------------------------------------------------

describe("AclRepository.grantAce and getAces (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("getAces returns empty list for a resource with no ACEs", async () => {
		const result = await runSuccess(
			AclRepository.pipe(
				Effect.flatMap((r) =>
					r.getAces(crypto.randomUUID(), "collection"),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(result).toHaveLength(0);
	});

	it("grantAce then getAces returns the inserted ACE", async () => {
		const resourceId = crypto.randomUUID();

		const result = await runSuccess(
			AclRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						yield* r.grantAce({
							resourceType: "collection",
							resourceId,
							principalType: "all",
							privilege: "DAV:read",
							grantDeny: "grant",
							protected: false,
							ordinal: 0,
						});
						return yield* r.getAces(resourceId, "collection");
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(result).toHaveLength(1);
		expect(result[0]?.privilege).toBe("DAV:read");
		expect(result[0]?.principalType).toBe("all");
		expect(result[0]?.grantDeny).toBe("grant");
	});

	it("getAces is scoped to resourceType — same resourceId with different type returns empty", async () => {
		const resourceId = crypto.randomUUID();

		const result = await runSuccess(
			AclRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						yield* r.grantAce({
							resourceType: "collection",
							resourceId,
							principalType: "all",
							privilege: "DAV:read",
							grantDeny: "grant",
							protected: false,
							ordinal: 0,
						});
						return yield* r.getAces(resourceId, "instance");
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(result).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// hasPrivilege
// ---------------------------------------------------------------------------

describe("AclRepository.hasPrivilege (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("returns false when no ACE exists for the resource", async () => {
		const result = await runSuccess(
			AclRepository.pipe(
				Effect.flatMap((r) =>
					r.hasPrivilege(
						[],
						crypto.randomUUID(),
						"collection",
						["DAV:read"],
						true,
					),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(result).toBe(false);
	});

	it("returns true after granting DAV:read to 'all'", async () => {
		const resourceId = crypto.randomUUID();

		const result = await runSuccess(
			AclRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						yield* r.grantAce({
							resourceType: "collection",
							resourceId,
							principalType: "all",
							privilege: "DAV:read",
							grantDeny: "grant",
							protected: false,
							ordinal: 0,
						});
						return yield* r.hasPrivilege(
							[],
							resourceId,
							"collection",
							["DAV:read"],
							false,
						);
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(result).toBe(true);
	});

	it("returns true for 'authenticated' principal when caller is authenticated", async () => {
		const resourceId = crypto.randomUUID();

		const result = await runSuccess(
			AclRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						yield* r.grantAce({
							resourceType: "collection",
							resourceId,
							principalType: "authenticated",
							privilege: "DAV:write",
							grantDeny: "grant",
							protected: false,
							ordinal: 0,
						});
						return yield* r.hasPrivilege(
							[],
							resourceId,
							"collection",
							["DAV:write"],
							true, // isAuthenticated = true
						);
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(result).toBe(true);
	});

	it("returns false for 'authenticated' ACE when caller is NOT authenticated", async () => {
		const resourceId = crypto.randomUUID();

		const result = await runSuccess(
			AclRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						yield* r.grantAce({
							resourceType: "collection",
							resourceId,
							principalType: "authenticated",
							privilege: "DAV:write",
							grantDeny: "grant",
							protected: false,
							ordinal: 0,
						});
						return yield* r.hasPrivilege(
							[],
							resourceId,
							"collection",
							["DAV:write"],
							false, // isAuthenticated = false
						);
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(result).toBe(false);
	});

	// Note: the `principalType = 'principal'` + ANY(principalIds) path is not
	// tested here because PGlite does not accept a parameterised array via
	// Drizzle's sql template (it expects a literal "{uuid,...}" array syntax).
	// That path is exercised by the service-layer unit tests against a mock
	// repository, and will be verified in production against the Bun SQL driver.
});

// ---------------------------------------------------------------------------
// getGrantedPrivileges
// ---------------------------------------------------------------------------

describe("AclRepository.getGrantedPrivileges (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("returns empty array when no ACEs exist", async () => {
		const result = await runSuccess(
			AclRepository.pipe(
				Effect.flatMap((r) =>
					r.getGrantedPrivileges([], crypto.randomUUID(), "collection", true),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(result).toHaveLength(0);
	});

	it("returns all granted privileges for 'all' principal", async () => {
		const resourceId = crypto.randomUUID();

		const result = await runSuccess(
			AclRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						yield* r.grantAce({
							resourceType: "instance",
							resourceId,
							principalType: "all",
							privilege: "DAV:read",
							grantDeny: "grant",
							protected: false,
							ordinal: 0,
						});
						yield* r.grantAce({
							resourceType: "instance",
							resourceId,
							principalType: "all",
							privilege: "DAV:write-content",
							grantDeny: "grant",
							protected: false,
							ordinal: 1,
						});
						return yield* r.getGrantedPrivileges(
							[],
							resourceId,
							"instance",
							true,
						);
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		const sorted = [...result].sort();
		expect(sorted).toEqual(["DAV:read", "DAV:write-content"]);
	});
});

// ---------------------------------------------------------------------------
// setAces
// ---------------------------------------------------------------------------

describe("AclRepository.setAces (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("setAces replaces non-protected ACEs", async () => {
		const resourceId = crypto.randomUUID();

		const result = await runSuccess(
			AclRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						// seed two non-protected ACEs
						yield* r.grantAce({
							resourceType: "collection",
							resourceId,
							principalType: "all",
							privilege: "DAV:read",
							grantDeny: "grant",
							protected: false,
							ordinal: 0,
						});
						yield* r.grantAce({
							resourceType: "collection",
							resourceId,
							principalType: "all",
							privilege: "DAV:write",
							grantDeny: "grant",
							protected: false,
							ordinal: 1,
						});
						// replace with a single new ACE
						yield* r.setAces(resourceId, "collection", [
							{
								resourceType: "collection",
								resourceId,
								principalType: "authenticated",
								privilege: "DAV:write-content",
								grantDeny: "grant",
								protected: false,
								ordinal: 0,
							},
						]);
						return yield* r.getAces(resourceId, "collection");
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(result).toHaveLength(1);
		expect(result[0]?.privilege).toBe("DAV:write-content");
		expect(result[0]?.principalType).toBe("authenticated");
	});

	it("setAces preserves protected ACEs", async () => {
		const resourceId = crypto.randomUUID();

		const result = await runSuccess(
			AclRepository.pipe(
				Effect.flatMap((r) =>
					Effect.gen(function* () {
						yield* r.grantAce({
							resourceType: "collection",
							resourceId,
							principalType: "all",
							privilege: "DAV:read",
							grantDeny: "grant",
							protected: true, // protected — must not be deleted
							ordinal: 0,
						});
						// setAces with empty list — should leave the protected ACE intact
						yield* r.setAces(resourceId, "collection", []);
						return yield* r.getAces(resourceId, "collection");
					}),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);

		expect(result).toHaveLength(1);
		expect(result[0]?.protected).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// getGroupPrincipalIds
// ---------------------------------------------------------------------------

describe("AclRepository.getGroupPrincipalIds (integration)", () => {
	let layer: TestLayer;

	beforeAll(() => {
		layer = makeTestLayer();
	});

	it("returns empty array when the user belongs to no groups", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const aclRepo = yield* AclRepository;
				const { principal } = yield* userRepo.create({
					slug: Slug("solo-user"),
					name: "Solo",
					email: Email("solo@example.com"),
					credentials: [],
				});
				return yield* aclRepo.getGroupPrincipalIds(
					PrincipalId(principal.id),
				);
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(result).toHaveLength(0);
	});
});
