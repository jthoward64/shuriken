import { describe, expect, it } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { RequestId } from "#src/domain/ids.ts";
import { Unauthenticated } from "#src/domain/types/dav.ts";
import {
	HTTP_METHOD_NOT_ALLOWED,
	HTTP_MOVED_PERMANENTLY,
	HTTP_NOT_FOUND,
	HTTP_OK,
} from "#src/http/status.ts";
import { AclServiceAllowAll } from "#src/services/acl/index.ts";
import { CalIndexRepository } from "#src/services/cal-index/index.ts";
import { CardIndexRepository } from "#src/services/card-index/index.ts";
import type { CollectionRow } from "#src/services/collection/repository.ts";
import {
	CollectionRepository,
	type CollectionRepositoryShape,
} from "#src/services/collection/repository.ts";
import type { CollectionServiceShape } from "#src/services/collection/service.ts";
import { CollectionService } from "#src/services/collection/service.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import type { ComponentRepositoryShape } from "#src/services/component/repository.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import type { EntityRepositoryShape } from "#src/services/entity/repository.ts";
import { GroupRepository, GroupService } from "#src/services/group/index.ts";
import type { GroupRepositoryShape } from "#src/services/group/repository.ts";
import type { GroupServiceShape } from "#src/services/group/service.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import {
	InstanceRepository,
	type InstanceRepositoryShape,
} from "#src/services/instance/repository.ts";
import type { InstanceServiceShape } from "#src/services/instance/service.ts";
import { InstanceService } from "#src/services/instance/service.ts";
import type { PrincipalWithUser } from "#src/services/principal/repository.ts";
import {
	PrincipalRepository,
	type PrincipalRepositoryShape,
} from "#src/services/principal/repository.ts";
import {
	PrincipalService,
	type PrincipalServiceShape,
} from "#src/services/principal/service.ts";
import { CalTimezoneRepository } from "#src/services/timezone/repository.ts";
import { TombstoneRepository } from "#src/services/tombstone/index.ts";
import { UserRepository, UserService } from "#src/services/user/index.ts";
import type { UserRepositoryShape } from "#src/services/user/repository.ts";
import type { UserServiceShape } from "#src/services/user/service.ts";
import { davRouter, parseDavPath } from "./router.ts";

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

/**
 * Creates a stub implementation of a service/repository interface.
 * Any method not in `overrides` returns `Effect.die("not implemented in router tests: <method>")`.
 */
const stubService = <T extends object>(overrides: Partial<T> = {}): T =>
	new Proxy(overrides as T, {
		get(target, prop, receiver) {
			if (prop in target) {
				return Reflect.get(target, prop, receiver);
			}
			return () =>
				Effect.die(`not implemented in router tests: ${String(prop)}`);
		},
	});

/** Build a minimal HttpRequestContext for a given method + pathname. */
const makeCtx = (method: string, pathname: string) => ({
	requestId: RequestId("test"),
	method,
	url: new URL(`http://localhost${pathname}`),
	headers: new Headers(),
	auth: new Unauthenticated(),
	clientIp: Option.none(),
});

/**
 * Seed data for the router layer: slugs that should resolve successfully.
 * Any slug absent from these maps will produce a 404.
 */
interface RouterSeeds {
	/** principalSlug → principal UUID */
	readonly principals?: ReadonlyMap<string, string>;
	/** `${principalId}:${collSlug}` → collection UUID */
	readonly collections?: ReadonlyMap<string, string>;
	/** `${collectionId}:${objSlug}` → instance UUID */
	readonly instances?: ReadonlyMap<string, string>;
}

/** Minimal CollectionService stub — router tests only exercise path resolution, not collection ops. */
const stubCollectionService: CollectionServiceShape =
	stubService<CollectionServiceShape>();

/** Minimal InstanceService stub — router tests only exercise path resolution. */
const stubInstanceService: InstanceServiceShape =
	stubService<InstanceServiceShape>();

/** Minimal PrincipalService stub — router tests only exercise path resolution. */
const stubPrincipalService: PrincipalServiceShape =
	stubService<PrincipalServiceShape>();

/** No-op EntityRepository — router path resolution never touches entity/component storage. */
const noopEntityRepo: EntityRepositoryShape =
	stubService<EntityRepositoryShape>({
		findById: () => Effect.succeed(Option.none()),
		updateLogicalUid: () => Effect.void,
		softDelete: () => Effect.void,
	});

/** No-op ComponentRepository — router path resolution never touches entity/component storage. */
const noopComponentRepo: ComponentRepositoryShape =
	stubService<ComponentRepositoryShape>({
		loadTree: () => Effect.succeed(Option.none()),
		deleteByEntity: () => Effect.void,
	});

/** No-op CalTimezoneRepository — router path resolution never touches timezone storage. */
const noopCalTimezoneRepo = CalTimezoneRepository.of(stubService());

/** Build a Layer providing all DAV router requirements from simple slug→id maps. */
const makeRouterLayer = (
	seeds: RouterSeeds = {},
): Layer.Layer<
	| PrincipalRepository
	| CollectionRepository
	| InstanceRepository
	| CollectionService
	| InstanceService
	| PrincipalService
	| import("#src/services/acl/index.ts").AclService
	| EntityRepository
	| ComponentRepository
	| CalTimezoneRepository
	| TombstoneRepository
	| CalIndexRepository
	| CardIndexRepository
	| UserRepository
	| GroupRepository
	| UserService
	| GroupService
> => {
	const principals = seeds.principals ?? new Map<string, string>();
	const collections = seeds.collections ?? new Map<string, string>();
	const instances = seeds.instances ?? new Map<string, string>();

	// Build reverse maps (id → slug) so UUID-based lookups also work.
	const principalById = new Map<string, string>(
		[...principals.entries()].map(([slug, id]) => [id, slug]),
	);
	// collection entries are keyed as `${principalId}:${collectionType}:${slug}` → id.
	// For findById we only need id → {principalId, collectionType, slug}.
	const collectionById = new Map<
		string,
		{ principalId: string; collectionType: string; slug: string }
	>(
		[...collections.entries()].map(([key, id]) => {
			const [principalId, collectionType, slug] = key.split(":") as [
				string,
				string,
				string,
			];
			return [id, { principalId, collectionType, slug }];
		}),
	);
	// instance entries: `${collectionId}:${slug}` → id.
	const instanceById = new Map<string, { collectionId: string; slug: string }>(
		[...instances.entries()].map(([key, id]) => {
			const colonIdx = key.indexOf(":");
			const collectionId = key.slice(0, colonIdx);
			const slug = key.slice(colonIdx + 1);
			return [id, { collectionId, slug }];
		}),
	);

	const principalRepo: PrincipalRepositoryShape =
		stubService<PrincipalRepositoryShape>({
			findBySlug: (slug) => {
				const id = principals.get(slug);
				if (!id) {
					return Effect.succeed(Option.none());
				}
				const row = {
					principal: {
						id,
						slug,
						principalType: "user",
						displayName: null,
						updatedAt: null,
						deletedAt: null,
					},
					user: {
						id: crypto.randomUUID(),
						principalId: id,
						name: slug,
						email: `${slug}@test`,
						updatedAt: null,
					},
				} as unknown as PrincipalWithUser;
				return Effect.succeed(Option.some(row));
			},
			findById: (id) => {
				const slug = principalById.get(id);
				if (!slug) {
					return Effect.succeed(Option.none());
				}
				const row = {
					principal: {
						id,
						slug,
						principalType: "user",
						displayName: null,
						updatedAt: null,
						deletedAt: null,
					},
					user: {
						id: crypto.randomUUID(),
						principalId: id,
						name: slug,
						email: `${slug}@test`,
						updatedAt: null,
					},
				} as unknown as PrincipalWithUser;
				return Effect.succeed(Option.some(row));
			},
			findByEmail: () => Effect.succeed(Option.none()),
			findUserByUserId: () => Effect.succeed(Option.none()),
		});

	const collectionRepo: CollectionRepositoryShape =
		stubService<CollectionRepositoryShape>({
			findBySlug: (principalId, collectionType, slug) => {
				const key = `${principalId}:${collectionType}:${slug}`;
				const id = collections.get(key);
				if (!id) {
					return Effect.succeed(Option.none());
				}
				const row = {
					id,
					slug,
					ownerPrincipalId: principalId,
					collectionType,
					deletedAt: null,
				} as unknown as CollectionRow;
				return Effect.succeed(Option.some(row));
			},
			findById: (id) => {
				const meta = collectionById.get(id);
				if (!meta) {
					return Effect.succeed(Option.none());
				}
				const row = {
					id,
					slug: meta.slug,
					ownerPrincipalId: meta.principalId,
					collectionType: meta.collectionType,
					deletedAt: null,
				} as unknown as CollectionRow;
				return Effect.succeed(Option.some(row));
			},
			listByOwner: () => Effect.succeed([]),
		});

	const instanceRepo: InstanceRepositoryShape =
		stubService<InstanceRepositoryShape>({
			findBySlug: (collectionId, slug) => {
				const key = `${collectionId}:${slug}`;
				const id = instances.get(key);
				if (!id) {
					return Effect.succeed(Option.none());
				}
				const row = {
					id,
					slug,
					collectionId,
					deletedAt: null,
				} as unknown as InstanceRow;
				return Effect.succeed(Option.some(row));
			},
			findById: (id) => {
				const meta = instanceById.get(id);
				if (!meta) {
					return Effect.succeed(Option.none());
				}
				const row = {
					id,
					slug: meta.slug,
					collectionId: meta.collectionId,
					deletedAt: null,
				} as unknown as InstanceRow;
				return Effect.succeed(Option.some(row));
			},
			listByCollection: () => Effect.succeed([]),
		});

	return Layer.mergeAll(
		Layer.succeed(PrincipalRepository, principalRepo),
		Layer.succeed(CollectionRepository, collectionRepo),
		Layer.succeed(InstanceRepository, instanceRepo),
		Layer.succeed(CollectionService, stubCollectionService),
		Layer.succeed(InstanceService, stubInstanceService),
		Layer.succeed(PrincipalService, stubPrincipalService),
		Layer.succeed(EntityRepository, noopEntityRepo),
		Layer.succeed(ComponentRepository, noopComponentRepo),
		Layer.succeed(CalTimezoneRepository, noopCalTimezoneRepo),
		Layer.succeed(TombstoneRepository, stubService()),
		Layer.succeed(CalIndexRepository, stubService()),
		Layer.succeed(CardIndexRepository, stubService()),
		Layer.succeed(
			UserRepository,
			stubService<UserRepositoryShape>({
				findById: () => Effect.succeed(Option.none()),
				findBySlug: () => Effect.succeed(Option.none()),
				findByEmail: () => Effect.succeed(Option.none()),
				list: () => Effect.succeed([]),
				softDelete: () => Effect.void,
				findCredential: () => Effect.succeed(Option.none()),
				deleteCredential: () => Effect.void,
			}),
		),
		Layer.succeed(
			GroupRepository,
			stubService<GroupRepositoryShape>({
				findById: () => Effect.succeed(Option.none()),
				findBySlug: () => Effect.succeed(Option.none()),
				list: () => Effect.succeed([]),
				listMembers: () => Effect.succeed([]),
				listByMember: () => Effect.succeed([]),
				softDelete: () => Effect.void,
				setMembers: () => Effect.void,
				addMember: () => Effect.void,
				removeMember: () => Effect.void,
				hasMember: () => Effect.succeed(false),
			}),
		),
		Layer.succeed(
			UserService,
			stubService<UserServiceShape>({ list: () => Effect.succeed([]) }),
		),
		Layer.succeed(
			GroupService,
			stubService<GroupServiceShape>({
				list: () => Effect.succeed([]),
				listMembers: () => Effect.succeed([]),
				listByMember: () => Effect.succeed([]),
			}),
		),
		AclServiceAllowAll,
	);
};

const run = (method: string, pathname: string, seeds?: RouterSeeds) => {
	const req = new Request(`http://localhost${pathname}`, { method });
	const ctx = makeCtx(method, pathname);
	return Effect.runPromise(
		davRouter(req, ctx).pipe(Effect.provide(makeRouterLayer(seeds))),
	);
};

const runPath = (pathname: string, seeds?: RouterSeeds) =>
	Effect.runPromise(
		parseDavPath(new URL(`http://localhost${pathname}`)).pipe(
			Effect.provide(makeRouterLayer(seeds)),
		),
	);

// ---------------------------------------------------------------------------
// Well-known redirects (RFC 6764 §5)
// ---------------------------------------------------------------------------

describe("davRouter — well-known redirects", () => {
	it("GET /.well-known/caldav returns 301 to /dav/", async () => {
		const res = await run("GET", "/.well-known/caldav");
		expect(res.status).toBe(HTTP_MOVED_PERMANENTLY);
		expect(res.headers.get("Location")).toBe("/dav/");
	});

	it("GET /.well-known/carddav returns 301 to /dav/", async () => {
		const res = await run("GET", "/.well-known/carddav");
		expect(res.status).toBe(HTTP_MOVED_PERMANENTLY);
		expect(res.headers.get("Location")).toBe("/dav/");
	});
});

// ---------------------------------------------------------------------------
// Unknown paths
// ---------------------------------------------------------------------------

describe("davRouter — unknown paths", () => {
	it("/dav/other-path returns 404", async () => {
		const res = await run("OPTIONS", "/dav/other-path");
		expect(res.status).toBe(HTTP_NOT_FOUND);
	});

	it("/dav/principals with no slug segment resolves to principalCollection (not 404)", async () => {
		// /dav/principals/ is a valid path (RFC 3744 §5.2 principal-collection-set).
		// Returns 200 from the OPTIONS stub handler, not 404.
		const res = await run("OPTIONS", "/dav/principals");
		expect(res.status).not.toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// Principal slug resolution
// ---------------------------------------------------------------------------

describe("davRouter — principal slug resolution", () => {
	it("OPTIONS /dav/principals/alice/ returns 200 when alice exists", async () => {
		const aliceId = crypto.randomUUID();
		const res = await run("OPTIONS", "/dav/principals/alice/", {
			principals: new Map([["alice", aliceId]]),
		});
		expect(res.status).toBe(HTTP_OK);
	});

	it("OPTIONS /dav/principals/{uuid}/ returns 200 when principal is accessed via its own UUID", async () => {
		const aliceId = crypto.randomUUID();
		const res = await run("OPTIONS", `/dav/principals/${aliceId}/`, {
			principals: new Map([["alice", aliceId]]),
		});
		expect(res.status).toBe(HTTP_OK);
	});

	it("OPTIONS /dav/principals/nobody/ returns 404 when principal is not seeded", async () => {
		const res = await run("OPTIONS", "/dav/principals/nobody/");
		expect(res.status).toBe(HTTP_NOT_FOUND);
	});

	it("URL-encoded slug %40alice is decoded to @alice before lookup", async () => {
		const id = crypto.randomUUID();
		const res = await run("OPTIONS", "/dav/principals/%40alice/", {
			principals: new Map([["@alice", id]]),
		});
		expect(res.status).toBe(HTTP_OK);
	});
});

// ---------------------------------------------------------------------------
// Collection slug resolution
// ---------------------------------------------------------------------------

describe("davRouter — collection slug resolution", () => {
	it("OPTIONS /dav/principals/alice/cal/my-cal returns 200 when collection exists", async () => {
		const aliceId = crypto.randomUUID();
		const calId = crypto.randomUUID();
		const res = await run("OPTIONS", "/dav/principals/alice/cal/my-cal", {
			principals: new Map([["alice", aliceId]]),
			collections: new Map([[`${aliceId}:calendar:my-cal`, calId]]),
		});
		expect(res.status).toBe(HTTP_OK);
	});

	it("OPTIONS /dav/principals/{uuid}/cal/{uuid}/ returns 200 when accessed via canonical UUID path", async () => {
		const aliceId = crypto.randomUUID();
		const calId = crypto.randomUUID();
		const res = await run(
			"OPTIONS",
			`/dav/principals/${aliceId}/cal/${calId}/`,
			{
				principals: new Map([["alice", aliceId]]),
				collections: new Map([[`${aliceId}:calendar:my-cal`, calId]]),
			},
		);
		expect(res.status).toBe(HTTP_OK);
	});

	// RFC 4918 §9.2: OPTIONS succeeds on any URL, including non-existent collections.
	it("OPTIONS /dav/principals/alice/cal/unknown returns 200 when collection not seeded", async () => {
		const aliceId = crypto.randomUUID();
		const res = await run("OPTIONS", "/dav/principals/alice/cal/unknown", {
			principals: new Map([["alice", aliceId]]),
		});
		expect(res.status).toBe(HTTP_OK);
	});

	it("OPTIONS /dav/principals/alice/unknown-ns returns 404 for unknown namespace", async () => {
		const aliceId = crypto.randomUUID();
		const res = await run(
			"OPTIONS",
			"/dav/principals/alice/unknown-ns/my-cal",
			{ principals: new Map([["alice", aliceId]]) },
		);
		expect(res.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// Instance slug resolution
// ---------------------------------------------------------------------------

describe("davRouter — instance slug resolution", () => {
	it("OPTIONS .../cal/my-cal/event.ics returns 200 when instance exists", async () => {
		const aliceId = crypto.randomUUID();
		const calId = crypto.randomUUID();
		const instId = crypto.randomUUID();
		const res = await run(
			"OPTIONS",
			"/dav/principals/alice/cal/my-cal/event.ics",
			{
				principals: new Map([["alice", aliceId]]),
				collections: new Map([[`${aliceId}:calendar:my-cal`, calId]]),
				instances: new Map([[`${calId}:event.ics`, instId]]),
			},
		);
		expect(res.status).toBe(HTTP_OK);
	});

	it("OPTIONS on a canonical UUID instance path returns 200", async () => {
		const aliceId = crypto.randomUUID();
		const calId = crypto.randomUUID();
		const instId = crypto.randomUUID();
		const res = await run(
			"OPTIONS",
			`/dav/principals/${aliceId}/cal/${calId}/${instId}`,
			{
				principals: new Map([["alice", aliceId]]),
				collections: new Map([[`${aliceId}:calendar:my-cal`, calId]]),
				instances: new Map([[`${calId}:event.ics`, instId]]),
			},
		);
		expect(res.status).toBe(HTTP_OK);
	});

	// RFC 4918 §9.2: OPTIONS succeeds on any URL, including non-existent instances.
	it("OPTIONS .../cal/my-cal/missing.ics returns 200 when instance not seeded", async () => {
		const aliceId = crypto.randomUUID();
		const calId = crypto.randomUUID();
		const res = await run(
			"OPTIONS",
			"/dav/principals/alice/cal/my-cal/missing.ics",
			{
				principals: new Map([["alice", aliceId]]),
				collections: new Map([[`${aliceId}:calendar:my-cal`, calId]]),
			},
		);
		expect(res.status).toBe(HTTP_OK);
	});
});

// ---------------------------------------------------------------------------
// Method dispatch
// ---------------------------------------------------------------------------

describe("davRouter — method dispatch", () => {
	it("unrecognized method PATCH on a principal returns 405 with an Allow header", async () => {
		const aliceId = crypto.randomUUID();
		const res = await run("PATCH", "/dav/principals/alice/", {
			principals: new Map([["alice", aliceId]]),
		});
		expect(res.status).toBe(HTTP_METHOD_NOT_ALLOWED);
		expect(res.headers.get("Allow")).toContain("OPTIONS");
	});
});

// ---------------------------------------------------------------------------
// DavError → bare HTTP response (router.ts catchTag)
// ---------------------------------------------------------------------------

describe("davRouter — DavError → bare Response", () => {
	it("a path-resolution 404 produces a Response with an empty body", async () => {
		const res = await run("OPTIONS", "/dav/principals/ghost/");
		expect(res.status).toBe(HTTP_NOT_FOUND);
		expect(await res.text()).toBe("");
	});
});

// ---------------------------------------------------------------------------
// new-resource path resolution
// ---------------------------------------------------------------------------

describe("davRouter — new-resource path resolution", () => {
	it("missing collection under existing principal resolves to new-collection with correct fields", async () => {
		const aliceId = crypto.randomUUID();
		const path = await runPath("/dav/principals/alice/cal/new-cal", {
			principals: new Map([["alice", aliceId]]),
		});
		expect(path.kind).toBe("new-collection");
		if (path.kind === "new-collection") {
			expect(String(path.principalId)).toBe(aliceId);
			expect(path.namespace).toBe("cal");
			expect(String(path.slug)).toBe("new-cal");
		}
	});

	it("missing instance under existing collection resolves to new-instance with correct fields", async () => {
		const aliceId = crypto.randomUUID();
		const calId = crypto.randomUUID();
		const path = await runPath("/dav/principals/alice/cal/my-cal/event.ics", {
			principals: new Map([["alice", aliceId]]),
			collections: new Map([[`${aliceId}:calendar:my-cal`, calId]]),
		});
		expect(path.kind).toBe("new-instance");
		if (path.kind === "new-instance") {
			expect(String(path.principalId)).toBe(aliceId);
			expect(path.namespace).toBe("cal");
			expect(String(path.collectionId)).toBe(calId);
			expect(String(path.slug)).toBe("event.ics");
		}
	});

	it("missing principal resolves to unknownPrincipal (not new-collection)", async () => {
		const path = await Effect.runPromise(
			parseDavPath(
				new URL("http://localhost/dav/principals/nobody/cal/new-cal"),
			).pipe(Effect.provide(makeRouterLayer())),
		);
		expect(path.kind).toBe("unknownPrincipal");
	});
});
