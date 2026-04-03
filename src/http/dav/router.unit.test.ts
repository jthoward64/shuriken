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
import type { CollectionRow } from "#src/services/collection/repository.ts";
import {
	CollectionRepository,
	type CollectionRepositoryShape,
} from "#src/services/collection/repository.ts";
import type { InstanceRow } from "#src/services/instance/repository.ts";
import {
	InstanceRepository,
	type InstanceRepositoryShape,
} from "#src/services/instance/repository.ts";
import type { PrincipalWithUser } from "#src/services/principal/repository.ts";
import {
	PrincipalRepository,
	type PrincipalRepositoryShape,
} from "#src/services/principal/repository.ts";
import { davRouter } from "./router.ts";

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

/** Build a Layer providing the three repo services from simple slug→id maps. */
const makeRouterLayer = (
	seeds: RouterSeeds = {},
): Layer.Layer<PrincipalRepository | CollectionRepository | InstanceRepository> => {
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
		findBySlug: (principalId, slug) => {
			const key = `${principalId}:${slug}`;
			const id = collections.get(key);
			if (!id) {
				return Effect.succeed(Option.none());
			}
			const row = { id, slug, ownerPrincipalId: principalId, deletedAt: null } as unknown as CollectionRow;
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
	);
};

const run = (method: string, pathname: string, seeds?: RouterSeeds) => {
	const req = new Request(`http://localhost${pathname}`, { method });
	const ctx = makeCtx(method, pathname);
	return Effect.runPromise(
		davRouter(req, ctx).pipe(Effect.provide(makeRouterLayer(seeds))),
	);
};

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

	it("/dav/principals with no slug segment returns 404", async () => {
		const res = await run("OPTIONS", "/dav/principals");
		expect(res.status).toBe(HTTP_NOT_FOUND);
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
	it("OPTIONS /dav/principals/alice/my-cal returns 200 when collection exists", async () => {
		const aliceId = crypto.randomUUID();
		const calId = crypto.randomUUID();
		const res = await run(
			"OPTIONS",
			"/dav/principals/alice/my-cal",
			{
				principals: new Map([["alice", aliceId]]),
				collections: new Map([[`${aliceId}:my-cal`, calId]]),
			},
		);
		expect(res.status).toBe(HTTP_OK);
	});

	it("OPTIONS /dav/principals/alice/unknown returns 404 when collection not seeded", async () => {
		const aliceId = crypto.randomUUID();
		const res = await run(
			"OPTIONS",
			"/dav/principals/alice/unknown",
			{ principals: new Map([["alice", aliceId]]) },
		);
		expect(res.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// Instance slug resolution
// ---------------------------------------------------------------------------

describe("davRouter — instance slug resolution", () => {
	it("OPTIONS .../my-cal/event.ics returns 200 when instance exists", async () => {
		const aliceId = crypto.randomUUID();
		const calId = crypto.randomUUID();
		const instId = crypto.randomUUID();
		const res = await run(
			"OPTIONS",
			"/dav/principals/alice/my-cal/event.ics",
			{
				principals: new Map([["alice", aliceId]]),
				collections: new Map([[`${aliceId}:my-cal`, calId]]),
				instances: new Map([[`${calId}:event.ics`, instId]]),
			},
		);
		expect(res.status).toBe(HTTP_OK);
	});

	it("OPTIONS .../my-cal/missing.ics returns 404 when instance not seeded", async () => {
		const aliceId = crypto.randomUUID();
		const calId = crypto.randomUUID();
		const res = await run(
			"OPTIONS",
			"/dav/principals/alice/my-cal/missing.ics",
			{
				principals: new Map([["alice", aliceId]]),
				collections: new Map([[`${aliceId}:my-cal`, calId]]),
			},
		);
		expect(res.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// Method dispatch
// ---------------------------------------------------------------------------

describe("davRouter — method dispatch", () => {
	it("unrecognized method PATCH returns 405 with an Allow header", async () => {
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
