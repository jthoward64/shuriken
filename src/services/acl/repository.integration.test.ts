import { beforeAll, describe, expect, it } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { CollectionId, EntityId, PrincipalId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email, type ETag } from "#src/domain/types/strings.ts";
import { CollectionRepositoryLive } from "#src/services/collection/repository.live.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { EntityRepositoryLive } from "#src/services/entity/repository.live.ts";
import { EntityRepository } from "#src/services/entity/repository.ts";
import { InstanceRepositoryLive } from "#src/services/instance/repository.live.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";
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
				Effect.flatMap((r) => r.getAces(crypto.randomUUID(), "collection")),
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
				return yield* aclRepo.getGroupPrincipalIds(PrincipalId(principal.id));
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(result).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// getResourceParent
// ---------------------------------------------------------------------------

describe("AclRepository.getResourceParent (integration)", () => {
	type FullLayer = Layer.Layer<
		| AclRepository
		| UserRepository
		| CollectionRepository
		| EntityRepository
		| InstanceRepository,
		Error
	>;
	let layer: FullLayer;

	beforeAll(() => {
		const db = makePgliteDatabaseLayer();
		layer = Layer.mergeAll(
			AclRepositoryLive.pipe(Layer.provide(db)),
			UserRepositoryLive.pipe(Layer.provide(db)),
			CollectionRepositoryLive.pipe(Layer.provide(db)),
			EntityRepositoryLive.pipe(Layer.provide(db)),
			InstanceRepositoryLive.pipe(Layer.provide(db)),
		);
	});

	it("returns None for a principal (top of hierarchy)", async () => {
		const result = await runSuccess(
			AclRepository.pipe(
				Effect.flatMap((r) =>
					r.getResourceParent(crypto.randomUUID(), "principal"),
				),
				Effect.provide(layer),
				Effect.orDie,
			),
		);
		expect(Option.isNone(result)).toBe(true);
	});

	it("returns the owner principal for a root collection (no parent_collection_id)", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const collectionRepo = yield* CollectionRepository;
				const aclRepo = yield* AclRepository;

				const { principal } = yield* userRepo.create({
					slug: Slug("rp-root-owner"),
					name: "Root Owner",
					email: Email("rp-root@example.com"),
					credentials: [],
				});
				const collection = yield* collectionRepo.insert({
					ownerPrincipalId: PrincipalId(principal.id),
					collectionType: "calendar",
					slug: Slug("rp-root-cal"),
				});
				return yield* aclRepo.getResourceParent(collection.id, "collection");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(Option.isSome(result)).toBe(true);
		if (Option.isSome(result)) {
			expect(result.value.type).toBe("principal");
		}
	});

	it("returns the parent collection for a nested collection", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const collectionRepo = yield* CollectionRepository;
				const aclRepo = yield* AclRepository;

				const { principal } = yield* userRepo.create({
					slug: Slug("rp-nested-owner"),
					name: "Nested Owner",
					email: Email("rp-nested@example.com"),
					credentials: [],
				});
				const parent = yield* collectionRepo.insert({
					ownerPrincipalId: PrincipalId(principal.id),
					collectionType: "collection",
					slug: Slug("rp-parent-col"),
				});
				const child = yield* collectionRepo.insert({
					ownerPrincipalId: PrincipalId(principal.id),
					collectionType: "collection",
					slug: Slug("rp-child-col"),
					parentCollectionId: CollectionId(parent.id),
				});
				return yield* aclRepo.getResourceParent(child.id, "collection");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(Option.isSome(result)).toBe(true);
		if (Option.isSome(result)) {
			expect(result.value.type).toBe("collection");
		}
	});

	it("returns the parent collection for an instance", async () => {
		const result = await runSuccess(
			Effect.gen(function* () {
				const userRepo = yield* UserRepository;
				const collectionRepo = yield* CollectionRepository;
				const entityRepo = yield* EntityRepository;
				const instanceRepo = yield* InstanceRepository;
				const aclRepo = yield* AclRepository;

				const { principal } = yield* userRepo.create({
					slug: Slug("rp-inst-owner"),
					name: "Inst Owner",
					email: Email("rp-inst@example.com"),
					credentials: [],
				});
				const collection = yield* collectionRepo.insert({
					ownerPrincipalId: PrincipalId(principal.id),
					collectionType: "calendar",
					slug: Slug("rp-inst-cal"),
				});
				const entity = yield* entityRepo.insert({
					entityType: "icalendar",
					logicalUid: null,
				});
				const instance = yield* instanceRepo.insert({
					collectionId: CollectionId(collection.id),
					entityId: EntityId(entity.id),
					contentType: "text/calendar",
					etag: `"test-etag"` as ETag,
					slug: Slug("rp-event.ics"),
				});
				return yield* aclRepo.getResourceParent(instance.id, "instance");
			}).pipe(Effect.provide(layer), Effect.orDie),
		);
		expect(Option.isSome(result)).toBe(true);
		if (Option.isSome(result)) {
			expect(result.value.type).toBe("collection");
		}
	});
});
