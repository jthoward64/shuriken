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
import type { CollectionRow } from "#src/services/collection/repository.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import type { ComponentRepositoryShape } from "#src/services/component/repository.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import type { EntityRepositoryShape } from "#src/services/entity/repository.ts";
import {
	CollectionRepository,
	type CollectionRepositoryShape,
} from "#src/services/collection/repository.ts";
import { CollectionService } from "#src/services/collection/service.ts";
import type { CollectionServiceShape } from "#src/services/collection/service.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import {
	InstanceRepository,
	type InstanceRepositoryShape,
} from "#src/services/instance/repository.ts";
import { InstanceService } from "#src/services/instance/service.ts";
import type { InstanceServiceShape } from "#src/services/instance/service.ts";
import type { PrincipalWithUser } from "#src/services/principal/repository.ts";
import { PrincipalService, type PrincipalServiceShape } from "#src/services/principal/service.ts";
import {
	PrincipalRepository,
	type PrincipalRepositoryShape,
} from "#src/services/principal/repository.ts";
import { davRouter, parseDavPath } from "./router.ts";

// ---------------------------------------------------------------------------
// Test infrastructure
// ---------------------------------------------------------------------------

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
const stubCollectionService: CollectionServiceShape = {
	findById: () => Effect.die("not implemented in router tests"),
	findBySlug: () => Effect.die("not implemented in router tests"),
	listByOwner: () => Effect.die("not implemented in router tests"),
	create: () => Effect.die("not implemented in router tests"),
	delete: () => Effect.die("not implemented in router tests"),
};

/** Minimal InstanceService stub — router tests only exercise path resolution. */
const stubInstanceService: InstanceServiceShape = {
	findById: () => Effect.die("not implemented in router tests"),
	findBySlug: () => Effect.die("not implemented in router tests"),
	listByCollection: () => Effect.die("not implemented in router tests"),
	put: () => Effect.die("not implemented in router tests"),
	delete: () => Effect.die("not implemented in router tests"),
};

/** Minimal PrincipalService stub — router tests only exercise path resolution. */
const stubPrincipalService: PrincipalServiceShape = {
	findById: () => Effect.die("not implemented in router tests"),
	findBySlug: () => Effect.die("not implemented in router tests"),
	findByEmail: () => Effect.die("not implemented in router tests"),
};

/** No-op EntityRepository — router path resolution never touches entity/component storage. */
const noopEntityRepo: EntityRepositoryShape = {
	insert: () => Effect.die("not implemented in router tests"),
	findById: () => Effect.succeed(Option.none()),
	updateLogicalUid: () => Effect.void,
	softDelete: () => Effect.void,
};

/** No-op ComponentRepository — router path resolution never touches entity/component storage. */
const noopComponentRepo: ComponentRepositoryShape = {
	insertTree: () => Effect.die("not implemented in router tests"),
	loadTree: () => Effect.succeed(Option.none()),
	deleteByEntity: () => Effect.void,
};

/** Build a Layer providing all DAV router requirements from simple slug→id maps. */
const makeRouterLayer = (
	seeds: RouterSeeds = {},
): Layer.Layer<PrincipalRepository | CollectionRepository | InstanceRepository | CollectionService | InstanceService | PrincipalService | import("#src/services/acl/index.ts").AclService | EntityRepository | ComponentRepository> => {
	const principals = seeds.principals ?? new Map<string, string>();
	const collections = seeds.collections ?? new Map<string, string>();
	const instances = seeds.instances ?? new Map<string, string>();

	const principalRepo: PrincipalRepositoryShape = {
		findBySlug: (slug) => {
			const id = principals.get(slug);
			if (!id) {
				return Effect.succeed(Option.none());
			}
			const row = {
				principal: { id, slug, principalType: "user", displayName: null, updatedAt: null, deletedAt: null },
				user: { id: crypto.randomUUID(), principalId: id, name: slug, email: `${slug}@test`, updatedAt: null },
			} as unknown as PrincipalWithUser;
			return Effect.succeed(Option.some(row));
		},
		findById: () => Effect.succeed(Option.none()),
		findByEmail: () => Effect.succeed(Option.none()),
		findUserByUserId: () => Effect.succeed(Option.none()),
	};

	const collectionRepo: CollectionRepositoryShape = {
		findBySlug: (principalId, collectionType, slug) => {
			const key = `${principalId}:${collectionType}:${slug}`;
			const id = collections.get(key);
			if (!id) {
				return Effect.succeed(Option.none());
			}
			const row = { id, slug, ownerPrincipalId: principalId, collectionType, deletedAt: null } as unknown as CollectionRow;
			return Effect.succeed(Option.some(row));
		},
		findById: () => Effect.succeed(Option.none()),
		listByOwner: () => Effect.succeed([]),
		insert: () => Effect.die("not implemented in router tests"),
		softDelete: () => Effect.die("not implemented in router tests"),
	};

	const instanceRepo: InstanceRepositoryShape = {
		findBySlug: (collectionId, slug) => {
			const key = `${collectionId}:${slug}`;
			const id = instances.get(key);
			if (!id) {
				return Effect.succeed(Option.none());
			}
			const row = { id, slug, collectionId, deletedAt: null } as unknown as InstanceRow;
			return Effect.succeed(Option.some(row));
		},
		findById: () => Effect.succeed(Option.none()),
		listByCollection: () => Effect.succeed([]),
		insert: () => Effect.die("not implemented in router tests"),
		updateEtag: () => Effect.die("not implemented in router tests"),
		softDelete: () => Effect.die("not implemented in router tests"),
	};

	return Layer.mergeAll(
		Layer.succeed(PrincipalRepository, principalRepo),
		Layer.succeed(CollectionRepository, collectionRepo),
		Layer.succeed(InstanceRepository, instanceRepo),
		Layer.succeed(CollectionService, stubCollectionService),
		Layer.succeed(InstanceService, stubInstanceService),
		Layer.succeed(PrincipalService, stubPrincipalService),
		Layer.succeed(EntityRepository, noopEntityRepo),
		Layer.succeed(ComponentRepository, noopComponentRepo),
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
		const res = await run(
			"OPTIONS",
			"/dav/principals/alice/",
			{ principals: new Map([["alice", aliceId]]) },
		);
		expect(res.status).toBe(HTTP_OK);
	});

	it("OPTIONS /dav/principals/nobody/ returns 404 when principal is not seeded", async () => {
		const res = await run("OPTIONS", "/dav/principals/nobody/");
		expect(res.status).toBe(HTTP_NOT_FOUND);
	});

	it("URL-encoded slug %40alice is decoded to @alice before lookup", async () => {
		const id = crypto.randomUUID();
		const res = await run(
			"OPTIONS",
			"/dav/principals/%40alice/",
			{ principals: new Map([["@alice", id]]) },
		);
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
		const res = await run(
			"OPTIONS",
			"/dav/principals/alice/cal/my-cal",
			{
				principals: new Map([["alice", aliceId]]),
				collections: new Map([[`${aliceId}:calendar:my-cal`, calId]]),
			},
		);
		expect(res.status).toBe(HTTP_OK);
	});

	it("OPTIONS /dav/principals/alice/cal/unknown returns 404 when collection not seeded", async () => {
		const aliceId = crypto.randomUUID();
		const res = await run(
			"OPTIONS",
			"/dav/principals/alice/cal/unknown",
			{ principals: new Map([["alice", aliceId]]) },
		);
		expect(res.status).toBe(HTTP_NOT_FOUND);
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

	it("OPTIONS .../cal/my-cal/missing.ics returns 404 when instance not seeded", async () => {
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
		expect(res.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// Method dispatch
// ---------------------------------------------------------------------------

describe("davRouter — method dispatch", () => {
	it("unrecognized method PATCH on a principal returns 405 with an Allow header", async () => {
		const aliceId = crypto.randomUUID();
		const res = await run(
			"PATCH",
			"/dav/principals/alice/",
			{ principals: new Map([["alice", aliceId]]) },
		);
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

	it("missing principal still rejects with a DavError (not silently converted to new-collection)", async () => {
		const exit = await Effect.runPromise(
			Effect.exit(
				parseDavPath(new URL("http://localhost/dav/principals/nobody/new-cal")).pipe(
					Effect.provide(makeRouterLayer()),
				),
			),
		);
		expect(exit._tag).toBe("Failure");
	});
});
