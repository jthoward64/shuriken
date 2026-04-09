import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { AuthService } from "#src/auth/service.ts";
import { AuthError, DatabaseError } from "#src/domain/errors.ts";
import type { PrincipalId, UserId } from "#src/domain/ids.ts";
import { Authenticated, type Unauthenticated } from "#src/domain/types/dav.ts";
import {
	CollectionRepository as CollectionRepoTag,
	InstanceRepository,
	PrincipalRepository,
} from "#src/layers.ts";
import { AclService } from "#src/services/acl/index.ts";
import { CalIndexRepository } from "#src/services/cal-index/index.ts";
import { CardIndexRepository } from "#src/services/card-index/index.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import { GroupRepository, GroupService } from "#src/services/group/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { PrincipalService } from "#src/services/principal/service.ts";
import { CalTimezoneRepository } from "#src/services/timezone/index.ts";
import { TombstoneRepository } from "#src/services/tombstone/index.ts";
import { UserRepository, UserService } from "#src/services/user/index.ts";
import { handleRequest } from "./router.ts";

// ---------------------------------------------------------------------------
// Mock Bun.Server
// ---------------------------------------------------------------------------

const mockServer = {
	requestIP: (_req: Request) => ({ address: "127.0.0.1" }),
} as unknown as import("bun").Server<unknown>;

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

const die = () => Effect.die("stub");

const authLayer = (
	result: Effect.Effect<
		Authenticated | Unauthenticated,
		AuthError | DatabaseError
	>,
) =>
	Layer.succeed(AuthService, {
		authenticate: (_headers, _ip) => result,
	});

const authenticated = new Authenticated({
	principal: {
		principalId: "00000000-0000-4000-8000-000000000001" as PrincipalId,
		userId: "00000000-0000-4000-8000-000000000002" as UserId,
		displayName: "Test User",
	},
});

// All-die stub layers for services that must be provided but won't be called.
// These stubs satisfy the type system; any actual call would crash the test fast.
const stubLayers = Layer.mergeAll(
	Layer.succeed(PrincipalRepository, {
		findById: die,
		findBySlug: die,
		findPrincipalBySlug: die,
		findByEmail: die,
		findUserByUserId: die,
		updateProperties: die,
	}),
	Layer.succeed(CollectionRepoTag, {
		findById: die,
		findBySlug: die,
		listByOwner: die,
		insert: die,
		softDelete: die,
		relocate: die,
		updateProperties: die,
	}),
	Layer.succeed(InstanceRepository, {
		findById: die,
		findBySlug: die,
		listByCollection: die,
		findChangedSince: die,
		findByIds: die,
		insert: die,
		updateEtag: die,
		softDelete: die,
		relocate: die,
		updateClientProperties: die,
	}),
	Layer.succeed(CollectionService, {
		findById: die,
		findBySlug: die,
		listByOwner: die,
		create: die,
		delete: die,
		updateProperties: die,
	}),
	Layer.succeed(InstanceService, {
		findById: die,
		findBySlug: die,
		listByCollection: die,
		put: die,
		delete: die,
		updateClientProperties: die,
	}),
	Layer.succeed(AclService, {
		check: die,
		currentUserPrivileges: die,
		getAces: die,
		setAces: die,
	}),
	Layer.succeed(PrincipalService, {
		findById: die,
		findBySlug: die,
		findByEmail: die,
		updateProperties: die,
	}),
	Layer.succeed(EntityRepository, {
		insert: die,
		findById: die,
		updateLogicalUid: die,
		softDelete: die,
	}),
	Layer.succeed(ComponentRepository, {
		insertTree: die,
		loadTree: die,
		deleteByEntity: die,
	}),
	Layer.succeed(CalTimezoneRepository, {
		findByTzid: die,
		upsert: die,
	}),
	Layer.succeed(TombstoneRepository, {
		findSinceRevision: die,
	}),
	Layer.succeed(CalIndexRepository, {
		findByTimeRange: die,
		findByComponentType: die,
		indexRruleOccurrences: die,
	}),
	Layer.succeed(CardIndexRepository, {
		findByText: die,
	}),
	Layer.succeed(UserRepository, {
		findById: die,
		findBySlug: die,
		findByEmail: die,
		list: die,
		softDelete: die,
		create: die,
		update: die,
		findCredential: die,
		insertCredential: die,
		deleteCredential: die,
	}),
	Layer.succeed(GroupRepository, {
		findById: die,
		findBySlug: die,
		list: die,
		listMembers: die,
		listByMember: die,
		softDelete: die,
		setMembers: die,
		create: die,
		update: die,
		addMember: die,
		removeMember: die,
		hasMember: die,
	}),
	Layer.succeed(UserService, {
		create: die,
		list: die,
		findById: die,
		findBySlug: die,
		update: die,
		delete: die,
		addCredential: die,
		removeCredential: die,
		setCredential: die,
	}),
	Layer.succeed(GroupService, {
		create: die,
		findById: die,
		list: die,
		listMembers: die,
		listByMember: die,
		update: die,
		delete: die,
		setMembers: die,
		addMember: die,
		removeMember: die,
	}),
);

const runWith = (
	req: Request,
	auth: Effect.Effect<
		Authenticated | Unauthenticated,
		AuthError | DatabaseError
	>,
): Promise<Response> => {
	const layer = Layer.merge(authLayer(auth), stubLayers);
	return Effect.runPromise(
		Effect.provide(handleRequest(req, mockServer), layer),
	);
};

const okAuth = Effect.succeed(authenticated);
const req = (method: string, path: string) =>
	new Request(`http://localhost${path}`, { method });

// ---------------------------------------------------------------------------
// Routing — non-DAV, non-UI paths
// ---------------------------------------------------------------------------

describe("handleRequest — routing", () => {
	it("returns 404 for unknown paths (not DAV, not UI)", async () => {
		const res = await runWith(req("GET", "/other"), okAuth);
		expect(res.status).toBe(404);
	});

	it("returns 404 for /api (not DAV, not UI)", async () => {
		const res = await runWith(req("GET", "/api/something"), okAuth);
		expect(res.status).toBe(404);
	});

	it("routes / to UI (200 HTML)", async () => {
		const res = await runWith(req("GET", "/"), okAuth);
		expect(res.status).toBe(200);
		const body = await res.text();
		expect(body).toContain("<!DOCTYPE html>");
	});

	it("routes /ui to UI (200 HTML)", async () => {
		const res = await runWith(req("GET", "/ui"), okAuth);
		expect(res.status).toBe(200);
	});

	it("routes /static/ prefix to UI (staticHandler placeholder → 404)", async () => {
		const res = await runWith(req("GET", "/static/app.js"), okAuth);
		expect(res.status).toBe(404);
	});

	it("routes /ui/ sub-paths to UI router (→ 404 from uiRouter)", async () => {
		const res = await runWith(req("GET", "/ui/dashboard"), okAuth);
		expect(res.status).toBe(404);
	});
});

// ---------------------------------------------------------------------------
// Error mapping — mapErrorToResponse
// ---------------------------------------------------------------------------

describe("handleRequest — mapErrorToResponse", () => {
	it("AuthError → 401 with WWW-Authenticate header", async () => {
		const res = await runWith(
			req("GET", "/other"),
			Effect.fail(new AuthError({ reason: "bad credentials" })),
		);
		expect(res.status).toBe(401);
		expect(res.headers.get("WWW-Authenticate")).toContain("Basic");
	});

	it("DatabaseError from auth → 500 Internal Server Error", async () => {
		const res = await runWith(
			req("GET", "/other"),
			Effect.fail(new DatabaseError({ cause: new Error("connection lost") })),
		);
		expect(res.status).toBe(500);
	});
});

// ---------------------------------------------------------------------------
// isDavPath edge cases
// ---------------------------------------------------------------------------

describe("isDavPath coverage", () => {
	it("exactly /dav is a DAV path (tries to route, stubs die → defect → 500)", async () => {
		// /dav with auth success → davRouter is called → needs real DAV services.
		// With stubs that die, this will result in a defect → 500.
		// The test confirms that /dav IS routed into the DAV handler (not 404).
		const res = await runWith(req("OPTIONS", "/dav"), okAuth);
		// davRouter will try to parse the path and use services → stubs die → 500
		// OR davRouter returns a response before needing any service (unlikely)
		// Either way, status should NOT be 404 (which is the fallback for unknown paths)
		expect(res.status).not.toBe(404);
	});

	it("/.well-known/caldav is a DAV path (not a 404)", async () => {
		const res = await runWith(req("GET", "/.well-known/caldav"), okAuth);
		expect(res.status).not.toBe(404);
	});

	it("/.well-known/carddav is a DAV path (not a 404)", async () => {
		const res = await runWith(req("GET", "/.well-known/carddav"), okAuth);
		expect(res.status).not.toBe(404);
	});
});

// ---------------------------------------------------------------------------
// mapErrorToResponse — DavError without precondition
// ---------------------------------------------------------------------------

// We test this by triggering a DavError from a real DAV path handler.
// Since we're in a unit test with stubs, most DAV paths will die on first
// service call. The DavError-without-precondition path is covered separately
// by integration tests where the handler explicitly returns such errors.
//
// ConflictError, XmlParseError, InternalError, ConfigError cannot be easily
// triggered without a full DAV service stack — they are exercised by integration
// tests. These are documented here for tracking coverage intent:
//
//   ConflictError → 409 (duplicate slug/email)
//   XmlParseError → 400 (malformed XML body)
//   InternalError → 500
//   ConfigError   → 500
