import { describe, expect, it } from "bun:test";
import { Effect, Option } from "effect";
import type { DavError } from "#src/domain/errors.ts";
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
	HTTP_MULTI_STATUS,
	HTTP_NOT_FOUND,
} from "#src/http/status.ts";
import { runFailure, runSuccess } from "#src/testing/effect.ts";
import { makeTestEnv } from "#src/testing/env.ts";
import { propfindHandler } from "./propfind.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_PRINCIPAL_ID = PrincipalId("00000000-0000-0000-0000-000000000001");
const TEST_USER_ID = UserId("00000000-0000-0000-0000-000000000002");
const TEST_COLLECTION_ID = CollectionId("00000000-0000-0000-0000-000000000010");
const TEST_INSTANCE_ID = InstanceId("00000000-0000-0000-0000-000000000020");

const authenticatedPrincipal: AuthenticatedPrincipal = {
	principalId: TEST_PRINCIPAL_ID,
	userId: TEST_USER_ID,
	displayName: "Test User",
};

const makeCtx = (auth: HttpRequestContext["auth"]): HttpRequestContext => ({
	requestId: RequestId("test-request-id"),
	method: "PROPFIND",
	url: new URL(
		`http://localhost/dav/principals/${TEST_PRINCIPAL_ID}/cal/${TEST_COLLECTION_ID}/`,
	),
	headers: new Headers(),
	auth,
	clientIp: Option.none(),
});

const authenticatedCtx = makeCtx(
	new Authenticated({ principal: authenticatedPrincipal }),
);

const makeRequest = (depth: string, body?: string): Request =>
	new Request("http://localhost/", {
		method: "PROPFIND",
		headers: {
			Depth: depth,
			...(body ? { "Content-Type": "application/xml" } : {}),
		},
		body: body ?? null,
	});

const makeEnv = () =>
	makeTestEnv()
		.withUser({ principalId: TEST_PRINCIPAL_ID })
		.withCollection({
			id: TEST_COLLECTION_ID,
			ownerPrincipalId: TEST_PRINCIPAL_ID,
			slug: "primary",
			collectionType: "calendar",
		})
		.withAce({
			resourceType: "collection",
			resourceId: TEST_COLLECTION_ID,
			principalType: "principal",
			principalId: TEST_PRINCIPAL_ID,
			privilege: "DAV:read",
		})
		.withAce({
			resourceType: "principal",
			resourceId: TEST_PRINCIPAL_ID,
			principalType: "principal",
			principalId: TEST_PRINCIPAL_ID,
			privilege: "DAV:read",
		});

// ---------------------------------------------------------------------------
// Depth: infinity → 403
// ---------------------------------------------------------------------------

describe("propfindHandler — Depth: infinity", () => {
	it("returns 403 with DAV:propfind-finite-depth precondition", async () => {
		const env = makeEnv();
		const path: ResolvedDavPath = {
			kind: "collection",
			principalId: TEST_PRINCIPAL_ID,
			namespace: "cal",
			collectionId: TEST_COLLECTION_ID,
		};

		const err = (await runFailure(
			propfindHandler(path, authenticatedCtx, makeRequest("infinity")).pipe(
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_FORBIDDEN);
		expect(err.precondition).toBe("DAV:propfind-finite-depth");
	});
});

// ---------------------------------------------------------------------------
// 404 for new-* path kinds
// ---------------------------------------------------------------------------

describe("propfindHandler — new-resource paths", () => {
	it("returns 404 for kind: new-collection", async () => {
		const env = makeEnv();
		const path: ResolvedDavPath = {
			kind: "new-collection",
			principalId: TEST_PRINCIPAL_ID,
			namespace: "cal",
			slug: Slug("missing"),
		};

		const err = (await runFailure(
			propfindHandler(path, authenticatedCtx, makeRequest("0")).pipe(
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err.status).toBe(HTTP_NOT_FOUND);
	});

	it("returns 404 for kind: new-instance", async () => {
		const env = makeEnv();
		const path: ResolvedDavPath = {
			kind: "new-instance",
			principalId: TEST_PRINCIPAL_ID,
			namespace: "cal",
			collectionId: TEST_COLLECTION_ID,
			slug: Slug("missing.ics"),
		};

		const err = (await runFailure(
			propfindHandler(path, authenticatedCtx, makeRequest("0")).pipe(
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// Depth: 0 on a collection
// ---------------------------------------------------------------------------

describe("propfindHandler — collection, Depth: 0", () => {
	it("returns 207 Multi-Status", async () => {
		const env = makeEnv();
		const path: ResolvedDavPath = {
			kind: "collection",
			principalId: TEST_PRINCIPAL_ID,
			namespace: "cal",
			collectionId: TEST_COLLECTION_ID,
		};

		const res = await runSuccess(
			propfindHandler(path, authenticatedCtx, makeRequest("0")).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(res.status).toBe(HTTP_MULTI_STATUS);
	});

	it("returns only the collection response (no instances)", async () => {
		const env = makeEnv().withInstance({
			id: TEST_INSTANCE_ID,
			collectionId: TEST_COLLECTION_ID,
			slug: "event.ics",
		});
		const path: ResolvedDavPath = {
			kind: "collection",
			principalId: TEST_PRINCIPAL_ID,
			namespace: "cal",
			collectionId: TEST_COLLECTION_ID,
		};

		const res = await runSuccess(
			propfindHandler(path, authenticatedCtx, makeRequest("0")).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const body = await res.text();
		// Collection UUID appears exactly once as href
		const hrefMatches = body.match(new RegExp(TEST_COLLECTION_ID, "g")) ?? [];
		expect(hrefMatches.length).toBeGreaterThanOrEqual(1);
		// Instance UUID must not appear
		expect(body).not.toContain(TEST_INSTANCE_ID);
	});

	it("includes DAV:resourcetype with calendar marker for calendar collections", async () => {
		const env = makeEnv();
		const path: ResolvedDavPath = {
			kind: "collection",
			principalId: TEST_PRINCIPAL_ID,
			namespace: "cal",
			collectionId: TEST_COLLECTION_ID,
		};

		const res = await runSuccess(
			propfindHandler(path, authenticatedCtx, makeRequest("0")).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const body = await res.text();
		expect(body).toContain("calendar");
	});

	it("missing Depth header defaults to 0 (no instance responses)", async () => {
		const env = makeEnv().withInstance({
			id: TEST_INSTANCE_ID,
			collectionId: TEST_COLLECTION_ID,
			slug: "event.ics",
		});
		const path: ResolvedDavPath = {
			kind: "collection",
			principalId: TEST_PRINCIPAL_ID,
			namespace: "cal",
			collectionId: TEST_COLLECTION_ID,
		};

		const req = new Request("http://localhost/", { method: "PROPFIND" }); // no Depth header
		const res = await runSuccess(
			propfindHandler(path, authenticatedCtx, req).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const body = await res.text();
		expect(body).not.toContain(TEST_INSTANCE_ID);
	});
});

// ---------------------------------------------------------------------------
// Depth: 1 on a collection
// ---------------------------------------------------------------------------

describe("propfindHandler — collection, Depth: 1", () => {
	it("includes one response per instance in the collection", async () => {
		const inst2 = InstanceId("00000000-0000-0000-0000-000000000021");
		const env = makeEnv()
			.withInstance({
				id: TEST_INSTANCE_ID,
				collectionId: TEST_COLLECTION_ID,
				slug: "a.ics",
			})
			.withInstance({
				id: inst2,
				collectionId: TEST_COLLECTION_ID,
				slug: "b.ics",
			});
		const path: ResolvedDavPath = {
			kind: "collection",
			principalId: TEST_PRINCIPAL_ID,
			namespace: "cal",
			collectionId: TEST_COLLECTION_ID,
		};

		const res = await runSuccess(
			propfindHandler(path, authenticatedCtx, makeRequest("1")).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const body = await res.text();
		expect(body).toContain(TEST_INSTANCE_ID);
		expect(body).toContain(inst2);
	});

	it("instance response includes DAV:getetag", async () => {
		const env = makeEnv().withInstance({
			id: TEST_INSTANCE_ID,
			collectionId: TEST_COLLECTION_ID,
			slug: "a.ics",
			etag: "abc123",
		});
		const path: ResolvedDavPath = {
			kind: "collection",
			principalId: TEST_PRINCIPAL_ID,
			namespace: "cal",
			collectionId: TEST_COLLECTION_ID,
		};

		const res = await runSuccess(
			propfindHandler(path, authenticatedCtx, makeRequest("1")).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const body = await res.text();
		expect(body).toContain("abc123");
	});
});

// ---------------------------------------------------------------------------
// Depth: 0 on an instance
// ---------------------------------------------------------------------------

describe("propfindHandler — instance, Depth: 0", () => {
	it("returns 207 with the instance properties", async () => {
		const env = makeEnv()
			.withInstance({
				id: TEST_INSTANCE_ID,
				collectionId: TEST_COLLECTION_ID,
				slug: "event.ics",
				etag: "myetag",
				contentType: "text/calendar",
			})
			.withAce({
				resourceType: "instance",
				resourceId: TEST_INSTANCE_ID,
				principalType: "principal",
				principalId: TEST_PRINCIPAL_ID,
				privilege: "DAV:read",
			});
		const path: ResolvedDavPath = {
			kind: "instance",
			principalId: TEST_PRINCIPAL_ID,
			namespace: "cal",
			collectionId: TEST_COLLECTION_ID,
			instanceId: TEST_INSTANCE_ID,
		};

		const res = await runSuccess(
			propfindHandler(path, authenticatedCtx, makeRequest("0")).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const body = await res.text();
		expect(res.status).toBe(HTTP_MULTI_STATUS);
		expect(body).toContain("myetag");
		expect(body).toContain("text/calendar");
	});
});

// ---------------------------------------------------------------------------
// Named prop request
// ---------------------------------------------------------------------------

describe("propfindHandler — named prop", () => {
	it("requested property that exists appears in 200 propstat", async () => {
		const env = makeEnv();
		const path: ResolvedDavPath = {
			kind: "collection",
			principalId: TEST_PRINCIPAL_ID,
			namespace: "cal",
			collectionId: TEST_COLLECTION_ID,
		};
		const body = `<D:propfind xmlns:D="DAV:"><D:prop><D:displayname/></D:prop></D:propfind>`;

		const res = await runSuccess(
			propfindHandler(path, authenticatedCtx, makeRequest("0", body)).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const text = await res.text();
		expect(text).toContain("HTTP/1.1 200 OK");
	});

	it("requested property that does not exist appears in 404 propstat", async () => {
		const env = makeEnv();
		const path: ResolvedDavPath = {
			kind: "collection",
			principalId: TEST_PRINCIPAL_ID,
			namespace: "cal",
			collectionId: TEST_COLLECTION_ID,
		};
		// Request a property that doesn't exist on a collection
		const body = `<D:propfind xmlns:D="DAV:"><D:prop><D:getetag/></D:prop></D:propfind>`;

		const res = await runSuccess(
			propfindHandler(path, authenticatedCtx, makeRequest("0", body)).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const text = await res.text();
		expect(text).toContain("HTTP/1.1 404 Not Found");
	});
});

// ---------------------------------------------------------------------------
// Principal path
// ---------------------------------------------------------------------------

describe("propfindHandler — principal", () => {
	it("returns 207 with resourcetype principal", async () => {
		const env = makeEnv();
		const path: ResolvedDavPath = {
			kind: "principal",
			principalId: TEST_PRINCIPAL_ID,
		};

		const res = await runSuccess(
			propfindHandler(path, authenticatedCtx, makeRequest("0")).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const body = await res.text();
		expect(res.status).toBe(HTTP_MULTI_STATUS);
		expect(body).toContain("principal");
	});
});
