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
	Unauthenticated,
} from "#src/domain/types/dav.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import { Slug } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import { HTTP_CREATED, HTTP_METHOD_NOT_ALLOWED } from "#src/http/status.ts";
import { runFailure, runSuccess } from "#src/testing/effect.ts";
import { makeTestEnv } from "#src/testing/env.ts";
import { mkcolHandler } from "./mkcol.ts";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const TEST_PRINCIPAL_ID = PrincipalId("00000000-0000-0000-0000-000000000001");
const TEST_USER_ID = UserId("00000000-0000-0000-0000-000000000002");

const authenticatedPrincipal: AuthenticatedPrincipal = {
	principalId: TEST_PRINCIPAL_ID,
	userId: TEST_USER_ID,
	displayName: "Test User",
};

const makeCtx = (
	auth: HttpRequestContext["auth"],
	method = "MKCALENDAR",
	namespace = "cal",
): HttpRequestContext => ({
	requestId: RequestId("test-request-id"),
	method,
	url: new URL(
		`http://localhost/dav/principals/${TEST_PRINCIPAL_ID}/${namespace}/my-new-cal`,
	),
	headers: new Headers(),
	auth,
	clientIp: Option.none(),
});

const makeNewCollectionPath = (
	namespace: "cal" | "card" | "col",
): ResolvedDavPath => ({
	kind: "new-collection",
	principalId: TEST_PRINCIPAL_ID,
	namespace,
	slug: Slug("my-new-cal"),
	principalSeg: String(TEST_PRINCIPAL_ID),
});

const authenticatedCtx = makeCtx(
	new Authenticated({ principal: authenticatedPrincipal }),
);
const unauthenticatedCtx = makeCtx(new Unauthenticated());

const makeRequest = (body?: string, contentType = "application/xml"): Request =>
	new Request("http://localhost/", {
		method: "MKCALENDAR",
		body: body ?? null,
		headers: body ? { "Content-Type": contentType } : {},
	});

const emptyRequest = makeRequest();

/**
 * Create a test env with a user seeded at TEST_PRINCIPAL_ID and a DAV:bind ACE
 * granting that principal the right to create collections under their own home.
 * Required because the real AclServiceLive checks ACE entries.
 */
const makeEnv = () =>
	makeTestEnv().withUser({ principalId: TEST_PRINCIPAL_ID }).withAce({
		resourceType: "principal",
		resourceId: TEST_PRINCIPAL_ID,
		principalType: "principal",
		principalId: TEST_PRINCIPAL_ID,
		privilege: "DAV:bind",
	});

// ---------------------------------------------------------------------------
// MKCALENDAR
// ---------------------------------------------------------------------------

describe("mkcolHandler — MKCALENDAR", () => {
	it("creates a calendar collection and returns 201 with Location header", async () => {
		const env = makeEnv();
		const path = makeNewCollectionPath("cal");

		const res = await runSuccess(
			mkcolHandler(path, authenticatedCtx, emptyRequest).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(res.status).toBe(HTTP_CREATED);
		expect(res.headers.get("Location")).not.toBeNull();
	});

	it("Location header reflects the principal segment and slug used in the request", async () => {
		const env = makeEnv();
		const path = makeNewCollectionPath("cal");

		const res = await runSuccess(
			mkcolHandler(path, authenticatedCtx, emptyRequest).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const location = res.headers.get("Location") ?? "";
		expect(location).toBe(
			`http://localhost/dav/principals/${TEST_PRINCIPAL_ID}/cal/my-new-cal/`,
		);
	});

	it("creates collection with collectionType 'calendar'", async () => {
		const env = makeEnv();
		const path = makeNewCollectionPath("cal");

		await runSuccess(
			mkcolHandler(path, authenticatedCtx, emptyRequest).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const rows = [...env.stores.collections.values()];
		expect(rows).toHaveLength(1);
		expect(rows[0]?.collectionType).toBe("calendar");
	});
});

// ---------------------------------------------------------------------------
// MKADDRESSBOOK
// ---------------------------------------------------------------------------

describe("mkcolHandler — MKADDRESSBOOK", () => {
	it("creates an addressbook collection and returns 201 with Location header", async () => {
		const env = makeEnv();
		const path = makeNewCollectionPath("card");
		const ctx = makeCtx(
			new Authenticated({ principal: authenticatedPrincipal }),
			"MKADDRESSBOOK",
			"card",
		);

		const res = await runSuccess(
			mkcolHandler(path, ctx, emptyRequest).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(res.status).toBe(HTTP_CREATED);
		const rows = [...env.stores.collections.values()];
		expect(rows[0]?.collectionType).toBe("addressbook");
	});

	it("Location header is under the card namespace", async () => {
		const env = makeEnv();
		const path = makeNewCollectionPath("card");
		const ctx = makeCtx(
			new Authenticated({ principal: authenticatedPrincipal }),
			"MKADDRESSBOOK",
			"card",
		);

		const res = await runSuccess(
			mkcolHandler(path, ctx, emptyRequest).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(res.headers.get("Location") ?? "").toContain("/card/");
	});
});

// ---------------------------------------------------------------------------
// MKCOL (plain collection)
// ---------------------------------------------------------------------------

describe("mkcolHandler — MKCOL", () => {
	it("creates a plain collection and returns 201", async () => {
		const env = makeEnv();
		const path = makeNewCollectionPath("col");
		const ctx = makeCtx(
			new Authenticated({ principal: authenticatedPrincipal }),
			"MKCOL",
			"col",
		);

		const res = await runSuccess(
			mkcolHandler(path, ctx, emptyRequest).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(res.status).toBe(HTTP_CREATED);
		const rows = [...env.stores.collections.values()];
		expect(rows[0]?.collectionType).toBe("collection");
	});
});

// ---------------------------------------------------------------------------
// Extended-MKCOL body parsing
// ---------------------------------------------------------------------------

describe("mkcolHandler — extended-MKCOL body", () => {
	it("parses displayname from the XML body and forwards it to create", async () => {
		const env = makeEnv();
		const path = makeNewCollectionPath("cal");
		const body = `<C:mkcalendar xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <D:displayname>My Work Calendar</D:displayname>
    </D:prop>
  </D:set>
</C:mkcalendar>`;

		await runSuccess(
			mkcolHandler(path, authenticatedCtx, makeRequest(body)).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const rows = [...env.stores.collections.values()];
		expect(rows[0]?.displayName).toBe("My Work Calendar");
	});

	it("parses calendar-description from the XML body", async () => {
		const env = makeEnv();
		const path = makeNewCollectionPath("cal");
		const body = `<C:mkcalendar xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <C:calendar-description>Work events</C:calendar-description>
    </D:prop>
  </D:set>
</C:mkcalendar>`;

		await runSuccess(
			mkcolHandler(path, authenticatedCtx, makeRequest(body)).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const rows = [...env.stores.collections.values()];
		expect(rows[0]?.description).toBe("Work events");
	});

	it("parses supported-calendar-component-set from the XML body", async () => {
		const env = makeEnv();
		const path = makeNewCollectionPath("cal");
		const body = `<C:mkcalendar xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:D="DAV:">
  <D:set>
    <D:prop>
      <C:supported-calendar-component-set>
        <C:comp name="VEVENT"/>
        <C:comp name="VTODO"/>
      </C:supported-calendar-component-set>
    </D:prop>
  </D:set>
</C:mkcalendar>`;

		await runSuccess(
			mkcolHandler(path, authenticatedCtx, makeRequest(body)).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		const rows = [...env.stores.collections.values()];
		expect(rows[0]?.supportedComponents).toEqual(
			expect.arrayContaining(["VEVENT", "VTODO"]),
		);
	});

	it("returns 201 with no body (tolerates absent XML)", async () => {
		const env = makeEnv();
		const path = makeNewCollectionPath("cal");

		const res = await runSuccess(
			mkcolHandler(path, authenticatedCtx, emptyRequest).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(res.status).toBe(HTTP_CREATED);
		const rows = [...env.stores.collections.values()];
		expect(rows[0]?.displayName).toBeNull();
	});

	it("tolerates malformed XML body — returns 201 with default props", async () => {
		const env = makeEnv();
		const path = makeNewCollectionPath("cal");

		const res = await runSuccess(
			mkcolHandler(path, authenticatedCtx, makeRequest("<not-closed-tag")).pipe(
				Effect.provide(env.toLayer()),
				Effect.orDie,
			),
		);

		expect(res.status).toBe(HTTP_CREATED);
	});
});

// ---------------------------------------------------------------------------
// 405 for non-new-collection path kinds
// ---------------------------------------------------------------------------

describe("mkcolHandler — method not allowed", () => {
	it("returns 405 for kind: collection (target already exists)", async () => {
		const env = makeEnv();
		const collectionPath: ResolvedDavPath = {
			kind: "collection",
			principalId: TEST_PRINCIPAL_ID,
			namespace: "cal",
			collectionId: CollectionId(crypto.randomUUID()),
			principalSeg: String(TEST_PRINCIPAL_ID),
			collectionSeg: "some-collection",
		};

		const err = (await runFailure(
			mkcolHandler(collectionPath, authenticatedCtx, emptyRequest).pipe(
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_METHOD_NOT_ALLOWED);
	});

	it("returns 405 for kind: instance", async () => {
		const env = makeEnv();
		const instancePath: ResolvedDavPath = {
			kind: "instance",
			principalId: TEST_PRINCIPAL_ID,
			namespace: "cal",
			collectionId: CollectionId(crypto.randomUUID()),
			instanceId: InstanceId(crypto.randomUUID()),
			principalSeg: String(TEST_PRINCIPAL_ID),
			collectionSeg: "some-collection",
			instanceSeg: "some-instance",
		};

		const err = (await runFailure(
			mkcolHandler(instancePath, authenticatedCtx, emptyRequest).pipe(
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_METHOD_NOT_ALLOWED);
	});

	it("returns 405 for kind: principal", async () => {
		const env = makeEnv();
		const principalPath: ResolvedDavPath = {
			kind: "principal",
			principalId: TEST_PRINCIPAL_ID,
			principalSeg: String(TEST_PRINCIPAL_ID),
		};

		const err = (await runFailure(
			mkcolHandler(principalPath, authenticatedCtx, emptyRequest).pipe(
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_METHOD_NOT_ALLOWED);
	});
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe("mkcolHandler — authentication", () => {
	it("returns 403 need-privileges for unauthenticated requests", async () => {
		const env = makeTestEnv();
		const path = makeNewCollectionPath("cal");

		const err = (await runFailure(
			mkcolHandler(path, unauthenticatedCtx, emptyRequest).pipe(
				Effect.provide(env.toLayer()),
			),
		)) as DavError;

		expect(err._tag).toBe("DavError");
		expect(err.precondition).toBe("DAV:need-privileges");
	});
});
