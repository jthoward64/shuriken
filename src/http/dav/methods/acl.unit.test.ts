import { describe, expect, it } from "bun:test";
import { Cause, Effect, Exit, Option } from "effect";
import type { DatabaseError, DavError } from "#src/domain/errors.ts";
import {
	CollectionId,
	InstanceId,
	PrincipalId,
	RequestId,
	UserId,
} from "#src/domain/ids.ts";
import {
	Authenticated,
	type AuthenticatedPrincipal,
} from "#src/domain/types/dav.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import { Slug } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	HTTP_FORBIDDEN,
	HTTP_METHOD_NOT_ALLOWED,
	HTTP_NOT_FOUND,
	HTTP_OK,
} from "#src/http/status.ts";
import { runSuccess } from "#src/testing/effect.ts";
import { makeTestEnv } from "#src/testing/env.ts";
import { aclHandler } from "./acl.ts";

/**
 * Run an ACL handler effect and expect a DavError failure.
 * DatabaseErrors become defects (they should not occur in unit tests).
 */
const runDavFailure = async (
	effect: Effect.Effect<unknown, DavError | DatabaseError, never>,
): Promise<DavError> => {
	const exit = await Effect.runPromiseExit(
		effect.pipe(Effect.catchTag("DatabaseError", Effect.die)),
	);
	if (Exit.isSuccess(exit)) {
		throw new Error("Expected effect to fail but it succeeded");
	}
	return Option.getOrElse(Cause.failureOption(exit.cause), () => {
		throw new Error(`Expected a Fail cause: ${Cause.pretty(exit.cause)}`);
	}) as DavError;
};

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_PRINCIPAL_ID = PrincipalId("00000000-0000-0000-0000-000000000001");
const TEST_USER_ID = UserId("00000000-0000-0000-0000-000000000002");
const TEST_COLLECTION_ID = CollectionId("00000000-0000-0000-0000-000000000003");
const TEST_INSTANCE_ID = InstanceId("00000000-0000-0000-0000-000000000004");
const TARGET_PRINCIPAL_ID = PrincipalId("00000000-0000-0000-0000-000000000010");

const authenticatedPrincipal: AuthenticatedPrincipal = {
	principalId: TEST_PRINCIPAL_ID,
	userId: TEST_USER_ID,
	displayName: Option.some("Test User"),
};

const authenticatedCtx: HttpRequestContext = {
	requestId: RequestId("test-request-id"),
	method: "ACL",
	url: new URL(
		`http://localhost/dav/principals/${TEST_PRINCIPAL_ID}/cal/${TEST_COLLECTION_ID}/`,
	),
	headers: new Headers(),
	auth: new Authenticated({ principal: authenticatedPrincipal }),
	clientIp: Option.none(),
	caldavTimezones: null,
};

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const makePrincipalPath = (): ResolvedDavPath => ({
	kind: "principal",
	principalId: TEST_PRINCIPAL_ID,
	principalSeg: String(TEST_PRINCIPAL_ID),
});

const makeCollectionPath = (): ResolvedDavPath => ({
	kind: "collection",
	principalId: TEST_PRINCIPAL_ID,
	principalSeg: String(TEST_PRINCIPAL_ID),
	namespace: "cal",
	collectionId: TEST_COLLECTION_ID,
	collectionSeg: String(TEST_COLLECTION_ID),
});

const makeInstancePath = (): ResolvedDavPath => ({
	kind: "instance",
	principalId: TEST_PRINCIPAL_ID,
	principalSeg: String(TEST_PRINCIPAL_ID),
	namespace: "cal",
	collectionId: TEST_COLLECTION_ID,
	collectionSeg: String(TEST_COLLECTION_ID),
	instanceId: TEST_INSTANCE_ID,
	instanceSeg: String(TEST_INSTANCE_ID),
});

const makeWellknownPath = (): ResolvedDavPath => ({
	kind: "wellknown",
	name: "caldav",
});

const makeRootPath = (): ResolvedDavPath => ({ kind: "root" });

const makePrincipalCollectionPath = (): ResolvedDavPath => ({
	kind: "principalCollection",
});

const makeNewCollectionPath = (): ResolvedDavPath => ({
	kind: "new-collection",
	principalId: TEST_PRINCIPAL_ID,
	principalSeg: String(TEST_PRINCIPAL_ID),
	namespace: "cal",
	slug: Slug("new-cal"),
});

const makeNewInstancePath = (): ResolvedDavPath => ({
	kind: "new-instance",
	principalId: TEST_PRINCIPAL_ID,
	principalSeg: String(TEST_PRINCIPAL_ID),
	namespace: "cal",
	collectionId: TEST_COLLECTION_ID,
	collectionSeg: String(TEST_COLLECTION_ID),
	slug: Slug("new-event.ics"),
});

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

const makeRequest = (body?: string): Request =>
	new Request("http://localhost/", {
		method: "ACL",
		body: body ?? null,
		headers: body ? { "Content-Type": "application/xml" } : {},
	});

const emptyRequest = makeRequest();

/** Build a <D:acl> XML body from a list of ACE descriptors. */
const makeAclXml = (
	aces: ReadonlyArray<{
		readonly principal: string;
		readonly privileges: ReadonlyArray<string>;
		readonly deny?: boolean;
	}>,
): string => {
	const aceXml = aces
		.map(({ principal, privileges, deny = false }) => {
			const privXml = privileges
				.map((p) => `<D:privilege><D:${p}/></D:privilege>`)
				.join("");
			const grantDeny = deny ? "deny" : "grant";
			return `<D:ace><D:principal>${principal}</D:principal><D:${grantDeny}>${privXml}</D:${grantDeny}></D:ace>`;
		})
		.join("");
	return `<D:acl xmlns:D="DAV:">${aceXml}</D:acl>`;
};

// ---------------------------------------------------------------------------
// Base test environment — seeds the acting user and write-acl ACE on a collection
// ---------------------------------------------------------------------------

const makeBaseEnv = () =>
	makeTestEnv()
		.withUser({ principalId: TEST_PRINCIPAL_ID, slug: "test-user" })
		.withUser({ principalId: TARGET_PRINCIPAL_ID, slug: "target-user" })
		.withCollection({
			id: TEST_COLLECTION_ID,
			ownerPrincipalId: TEST_PRINCIPAL_ID,
		})
		.withInstance({
			id: TEST_INSTANCE_ID,
			collectionId: TEST_COLLECTION_ID,
		})
		// Grant write-acl on collection and principal to acting user
		.withAce({
			resourceType: "collection",
			resourceId: TEST_COLLECTION_ID,
			principalType: "principal",
			principalId: TEST_PRINCIPAL_ID,
			privilege: "DAV:write-acl",
		})
		.withAce({
			resourceType: "principal",
			resourceId: TEST_PRINCIPAL_ID,
			principalType: "principal",
			principalId: TEST_PRINCIPAL_ID,
			privilege: "DAV:write-acl",
		})
		.withAce({
			resourceType: "instance",
			resourceId: TEST_INSTANCE_ID,
			principalType: "principal",
			principalId: TEST_PRINCIPAL_ID,
			privilege: "DAV:write-acl",
		});

// ---------------------------------------------------------------------------
// Path gating tests
// ---------------------------------------------------------------------------

describe("aclHandler — path gating", () => {
	it("returns 405 for wellknown path", async () => {
		const env = makeBaseEnv();
		const err = await runDavFailure(
			aclHandler(makeWellknownPath(), authenticatedCtx, emptyRequest).pipe(
				Effect.provide(env.toLayer()),
			),
		);
		expect(err.status).toBe(HTTP_METHOD_NOT_ALLOWED);
	});

	it("returns 405 for root path", async () => {
		const env = makeBaseEnv();
		const err = await runDavFailure(
			aclHandler(makeRootPath(), authenticatedCtx, emptyRequest).pipe(
				Effect.provide(env.toLayer()),
			),
		);
		expect(err.status).toBe(HTTP_METHOD_NOT_ALLOWED);
	});

	it("returns 405 for principalCollection path", async () => {
		const env = makeBaseEnv();
		const err = await runDavFailure(
			aclHandler(
				makePrincipalCollectionPath(),
				authenticatedCtx,
				emptyRequest,
			).pipe(Effect.provide(env.toLayer())),
		);
		expect(err.status).toBe(HTTP_METHOD_NOT_ALLOWED);
	});

	it("returns 404 for new-collection path", async () => {
		const env = makeBaseEnv();
		const err = await runDavFailure(
			aclHandler(makeNewCollectionPath(), authenticatedCtx, emptyRequest).pipe(
				Effect.provide(env.toLayer()),
			),
		);
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});

	it("returns 404 for new-instance path", async () => {
		const env = makeBaseEnv();
		const err = await runDavFailure(
			aclHandler(makeNewInstancePath(), authenticatedCtx, emptyRequest).pipe(
				Effect.provide(env.toLayer()),
			),
		);
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// Authorization guard
// ---------------------------------------------------------------------------

describe("aclHandler — authorization", () => {
	it("returns 403 DAV:need-privileges when acting principal has no write-acl", async () => {
		const env = makeTestEnv()
			.withUser({ principalId: TEST_PRINCIPAL_ID })
			.withCollection({
				id: TEST_COLLECTION_ID,
				ownerPrincipalId: TEST_PRINCIPAL_ID,
			});
		const err = await runDavFailure(
			aclHandler(makeCollectionPath(), authenticatedCtx, emptyRequest).pipe(
				Effect.provide(env.toLayer()),
			),
		);
		expect(err.status).toBe(HTTP_FORBIDDEN);
		expect(err.precondition).toBe("DAV:need-privileges");
	});
});

// ---------------------------------------------------------------------------
// Server restrictions
// ---------------------------------------------------------------------------

describe("aclHandler — grant-only restriction", () => {
	it("returns 403 DAV:grant-only when a deny ACE is present", async () => {
		const env = makeBaseEnv();
		const body = makeAclXml([
			{ principal: "<D:all/>", privileges: ["read"], deny: true },
		]);
		const err = await runDavFailure(
			aclHandler(
				makeCollectionPath(),
				authenticatedCtx,
				makeRequest(body),
			).pipe(Effect.provide(env.toLayer())),
		);
		expect(err.status).toBe(HTTP_FORBIDDEN);
		expect(err.precondition).toBe("DAV:grant-only");
	});
});

describe("aclHandler — no-invert restriction", () => {
	it("returns 403 DAV:no-invert when an invert principal is present", async () => {
		const env = makeBaseEnv();
		const body = `<D:acl xmlns:D="DAV:"><D:ace><D:principal><D:invert><D:all/></D:invert></D:principal><D:grant><D:privilege><D:read/></D:privilege></D:grant></D:ace></D:acl>`;
		const err = await runDavFailure(
			aclHandler(
				makeCollectionPath(),
				authenticatedCtx,
				makeRequest(body),
			).pipe(Effect.provide(env.toLayer())),
		);
		expect(err.status).toBe(HTTP_FORBIDDEN);
		expect(err.precondition).toBe("DAV:no-invert");
	});
});

describe("aclHandler — no property principal", () => {
	it("returns 403 DAV:not-supported-privilege when a property principal is present", async () => {
		const env = makeBaseEnv();
		const body = `<D:acl xmlns:D="DAV:"><D:ace><D:principal><D:property><D:owner/></D:property></D:principal><D:grant><D:privilege><D:read/></D:privilege></D:grant></D:ace></D:acl>`;
		const err = await runDavFailure(
			aclHandler(
				makeCollectionPath(),
				authenticatedCtx,
				makeRequest(body),
			).pipe(Effect.provide(env.toLayer())),
		);
		expect(err.status).toBe(HTTP_FORBIDDEN);
		expect(err.precondition).toBe("DAV:not-supported-privilege");
	});
});

// ---------------------------------------------------------------------------
// Principal validation
// ---------------------------------------------------------------------------

describe("aclHandler — href principal validation", () => {
	it("returns 403 DAV:recognized-principal for an unknown slug", async () => {
		const env = makeBaseEnv();
		const body = makeAclXml([
			{
				principal: "<D:href>/dav/principals/nonexistent-user</D:href>",
				privileges: ["read"],
			},
		]);
		const err = await runDavFailure(
			aclHandler(
				makeCollectionPath(),
				authenticatedCtx,
				makeRequest(body),
			).pipe(Effect.provide(env.toLayer())),
		);
		expect(err.status).toBe(HTTP_FORBIDDEN);
		expect(err.precondition).toBe("DAV:recognized-principal");
	});

	it("resolves a known slug to its principal ID", async () => {
		const env = makeBaseEnv();
		const body = makeAclXml([
			{
				principal: "<D:href>/dav/principals/target-user</D:href>",
				privileges: ["read"],
			},
		]);
		const res = await runSuccess(
			aclHandler(
				makeCollectionPath(),
				authenticatedCtx,
				makeRequest(body),
			).pipe(Effect.provide(env.toLayer()), Effect.orDie),
		);
		expect(res.status).toBe(HTTP_OK);

		const aces = env.stores.acl.get(TEST_COLLECTION_ID) ?? [];
		const written = aces.filter((a) => !a.protected && a.principalId !== null);
		expect(written).toHaveLength(1);
		expect(written[0]?.principalId).toBe(TARGET_PRINCIPAL_ID);
		expect(written[0]?.privilege).toBe("DAV:read");
	});

	it("resolves a known UUID href to its principal ID", async () => {
		const env = makeBaseEnv();
		const body = makeAclXml([
			{
				principal: `<D:href>/dav/principals/${TARGET_PRINCIPAL_ID}</D:href>`,
				privileges: ["read"],
			},
		]);
		const res = await runSuccess(
			aclHandler(
				makeCollectionPath(),
				authenticatedCtx,
				makeRequest(body),
			).pipe(Effect.provide(env.toLayer()), Effect.orDie),
		);
		expect(res.status).toBe(HTTP_OK);

		const aces = env.stores.acl.get(TEST_COLLECTION_ID) ?? [];
		const written = aces.filter((a) => !a.protected && a.principalId !== null);
		expect(written[0]?.principalId).toBe(TARGET_PRINCIPAL_ID);
	});
});

// ---------------------------------------------------------------------------
// Privilege validation
// ---------------------------------------------------------------------------

describe("aclHandler — privilege validation", () => {
	it("returns 403 DAV:not-supported-privilege for an unknown privilege", async () => {
		const env = makeBaseEnv();
		const body = `<D:acl xmlns:D="DAV:"><D:ace><D:principal><D:all/></D:principal><D:grant><D:privilege><D:fake-privilege/></D:privilege></D:grant></D:ace></D:acl>`;
		const err = await runDavFailure(
			aclHandler(
				makeCollectionPath(),
				authenticatedCtx,
				makeRequest(body),
			).pipe(Effect.provide(env.toLayer())),
		);
		expect(err.status).toBe(HTTP_FORBIDDEN);
		expect(err.precondition).toBe("DAV:not-supported-privilege");
	});
});

// ---------------------------------------------------------------------------
// Pseudo-principal types
// ---------------------------------------------------------------------------

describe("aclHandler — pseudo-principals", () => {
	for (const [label, principalXml] of [
		["DAV:all", "<D:all/>"],
		["DAV:authenticated", "<D:authenticated/>"],
		["DAV:unauthenticated", "<D:unauthenticated/>"],
		["DAV:self", "<D:self/>"],
	] as const) {
		it(`accepts ${label} principal`, async () => {
			const env = makeBaseEnv();
			const body = makeAclXml([
				{ principal: principalXml, privileges: ["read"] },
			]);
			const res = await runSuccess(
				aclHandler(
					makeCollectionPath(),
					authenticatedCtx,
					makeRequest(body),
				).pipe(Effect.provide(env.toLayer()), Effect.orDie),
			);
			expect(res.status).toBe(HTTP_OK);
		});
	}
});

// ---------------------------------------------------------------------------
// Successful writes
// ---------------------------------------------------------------------------

describe("aclHandler — successful writes", () => {
	it("returns 200 OK for empty body (clears non-protected ACEs)", async () => {
		const env = makeBaseEnv();
		const res = await runSuccess(
			aclHandler(makeCollectionPath(), authenticatedCtx, emptyRequest).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);
		expect(res.status).toBe(HTTP_OK);

		// Only the seeded protected=false write-acl ACE was not protected, so it gets cleared
		const aces = env.stores.acl.get(TEST_COLLECTION_ID) ?? [];
		const nonProtected = aces.filter((a) => !a.protected);
		expect(nonProtected).toHaveLength(0);
	});

	it("writes a single ACE with ordinal 0", async () => {
		const env = makeBaseEnv();
		const body = makeAclXml([{ principal: "<D:all/>", privileges: ["read"] }]);
		await runSuccess(
			aclHandler(
				makeCollectionPath(),
				authenticatedCtx,
				makeRequest(body),
			).pipe(Effect.provide(env.toLayer()), Effect.orDie),
		);

		const aces = env.stores.acl.get(TEST_COLLECTION_ID) ?? [];
		const written = aces.filter((a) => !a.protected);
		expect(written).toHaveLength(1);
		expect(written[0]?.ordinal).toBe(0);
		expect(written[0]?.privilege).toBe("DAV:read");
		expect(written[0]?.principalType).toBe("all");
		expect(written[0]?.grantDeny).toBe("grant");
	});

	it("assigns ascending ordinals (×10) across multiple ACEs", async () => {
		const env = makeBaseEnv();
		const body = makeAclXml([
			{ principal: "<D:all/>", privileges: ["read"] },
			{ principal: "<D:authenticated/>", privileges: ["write"] },
			{ principal: "<D:self/>", privileges: ["read-acl"] },
		]);
		await runSuccess(
			aclHandler(
				makeCollectionPath(),
				authenticatedCtx,
				makeRequest(body),
			).pipe(Effect.provide(env.toLayer()), Effect.orDie),
		);

		const aces = (env.stores.acl.get(TEST_COLLECTION_ID) ?? [])
			.filter((a) => !a.protected)
			.sort((a, b) => a.ordinal - b.ordinal);
		expect(aces).toHaveLength(3);
		expect(aces[0]?.ordinal).toBe(0);
		expect(aces[1]?.ordinal).toBe(10);
		expect(aces[2]?.ordinal).toBe(20);
	});

	it("multiple privileges in one ACE share the same ordinal", async () => {
		const env = makeBaseEnv();
		const body = makeAclXml([
			{ principal: "<D:all/>", privileges: ["read", "read-acl"] },
		]);
		await runSuccess(
			aclHandler(
				makeCollectionPath(),
				authenticatedCtx,
				makeRequest(body),
			).pipe(Effect.provide(env.toLayer()), Effect.orDie),
		);

		const aces = (env.stores.acl.get(TEST_COLLECTION_ID) ?? []).filter(
			(a) => !a.protected,
		);
		expect(aces).toHaveLength(2);
		expect(aces[0]?.ordinal).toBe(aces[1]?.ordinal);
		expect(aces[0]?.ordinal).toBe(0);
		const privileges = new Set(aces.map((a) => a.privilege));
		expect(privileges).toContain("DAV:read");
		expect(privileges).toContain("DAV:read-acl");
	});

	it("uses resourceType 'collection' for collection paths", async () => {
		const env = makeBaseEnv();
		const body = makeAclXml([{ principal: "<D:all/>", privileges: ["read"] }]);
		await runSuccess(
			aclHandler(
				makeCollectionPath(),
				authenticatedCtx,
				makeRequest(body),
			).pipe(Effect.provide(env.toLayer()), Effect.orDie),
		);

		const aces = (env.stores.acl.get(TEST_COLLECTION_ID) ?? []).filter(
			(a) => !a.protected,
		);
		expect(aces[0]?.resourceType).toBe("collection");
	});

	it("uses resourceType 'principal' for principal paths", async () => {
		const env = makeBaseEnv();
		const body = makeAclXml([{ principal: "<D:all/>", privileges: ["read"] }]);
		await runSuccess(
			aclHandler(makePrincipalPath(), authenticatedCtx, makeRequest(body)).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const aces = (env.stores.acl.get(TEST_PRINCIPAL_ID) ?? []).filter(
			(a) => !a.protected,
		);
		expect(aces[0]?.resourceType).toBe("principal");
	});

	it("uses resourceType 'instance' for instance paths", async () => {
		const env = makeBaseEnv();
		const body = makeAclXml([{ principal: "<D:all/>", privileges: ["read"] }]);
		await runSuccess(
			aclHandler(makeInstancePath(), authenticatedCtx, makeRequest(body)).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const aces = (env.stores.acl.get(TEST_INSTANCE_ID) ?? []).filter(
			(a) => !a.protected,
		);
		expect(aces[0]?.resourceType).toBe("instance");
	});

	it("preserves protected ACEs when replacing", async () => {
		const env = makeBaseEnv().withAce({
			resourceType: "collection",
			resourceId: TEST_COLLECTION_ID,
			principalType: "all",
			privilege: "DAV:read",
			protected: true,
		});
		const body = emptyRequest; // clear non-protected ACEs
		await runSuccess(
			aclHandler(makeCollectionPath(), authenticatedCtx, body).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const aces = env.stores.acl.get(TEST_COLLECTION_ID) ?? [];
		const protectedAces = aces.filter((a) => a.protected);
		expect(protectedAces).toHaveLength(1);
		expect(protectedAces[0]?.privilege).toBe("DAV:read");
	});
});
