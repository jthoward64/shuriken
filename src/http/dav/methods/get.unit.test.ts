import { describe, expect, it } from "bun:test";
import { Effect, Option } from "effect";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import {
	CollectionId,
	EntityId,
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
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	HTTP_METHOD_NOT_ALLOWED,
	HTTP_NOT_FOUND,
	HTTP_OK,
	HTTP_UNAUTHORIZED,
} from "#src/http/status.ts";
import type { AclService } from "#src/services/acl/index.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { InstanceService } from "#src/services/instance/index.ts";
import { runFailure, runSuccess } from "#src/testing/effect.ts";
import { makeTestEnv } from "#src/testing/env.ts";
import { getHandler } from "./get.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_PRINCIPAL_ID = PrincipalId("00000000-0000-0000-0000-000000000001");
const TEST_USER_ID = UserId("00000000-0000-0000-0000-000000000002");
const TEST_COLLECTION_ID = CollectionId("00000000-0000-0000-0000-000000000003");
const TEST_INSTANCE_ID = InstanceId("00000000-0000-0000-0000-000000000004");
const TEST_ENTITY_ID = EntityId("00000000-0000-0000-0000-000000000005");

const authenticatedPrincipal: AuthenticatedPrincipal = {
	principalId: TEST_PRINCIPAL_ID,
	userId: TEST_USER_ID,
	displayName: "Test User",
};

const makeCtx = (
	auth: HttpRequestContext["auth"],
	method = "GET",
): HttpRequestContext => ({
	requestId: RequestId("test-request-id"),
	method,
	url: new URL(
		`http://localhost/dav/principals/${TEST_PRINCIPAL_ID}/cal/${TEST_COLLECTION_ID}/${TEST_INSTANCE_ID}`,
	),
	headers: new Headers(),
	auth,
	clientIp: Option.none(),
});

const authenticatedCtx = makeCtx(
	new Authenticated({ principal: authenticatedPrincipal }),
);
const unauthenticatedCtx = makeCtx(new Unauthenticated());
const headCtx = makeCtx(
	new Authenticated({ principal: authenticatedPrincipal }),
	"HEAD",
);

const instancePath: ResolvedDavPath = {
	kind: "instance",
	principalId: TEST_PRINCIPAL_ID,
	namespace: "cal",
	collectionId: TEST_COLLECTION_ID,
	instanceId: TEST_INSTANCE_ID,
	principalSeg: String(TEST_PRINCIPAL_ID),
	collectionSeg: String(TEST_COLLECTION_ID),
	instanceSeg: String(TEST_INSTANCE_ID),
};

type GetEffect<A> = Effect.Effect<
	A,
	DavError | DatabaseError | InternalError,
	AclService | InstanceService | ComponentRepository
>;
type GetFailEffect = Effect.Effect<
	unknown,
	unknown,
	AclService | InstanceService | ComponentRepository
>;

const run = <A>(env: ReturnType<typeof makeTestEnv>, effect: GetEffect<A>) =>
	runSuccess(effect.pipe(Effect.provide(env.toLayer()), Effect.orDie));

const runErr = (env: ReturnType<typeof makeTestEnv>, effect: GetFailEffect) =>
	runFailure(effect.pipe(Effect.provide(env.toLayer())));

// ---------------------------------------------------------------------------
// Helpers to seed an instance + its component tree via PUT round-trip
// ---------------------------------------------------------------------------

/**
 * Build a test env with an instance seeded from the given iCalendar/vCard body,
 * so that GET can reconstruct it from the component store.
 */
const makeICalEnv = () => {
	const env = makeTestEnv()
		.withUser({ principalId: TEST_PRINCIPAL_ID })
		.withCollection({
			id: TEST_COLLECTION_ID,
			ownerPrincipalId: TEST_PRINCIPAL_ID,
			collectionType: "calendar",
		})
		.withAce({
			resourceType: "instance",
			resourceId: TEST_INSTANCE_ID,
			principalType: "principal",
			principalId: TEST_PRINCIPAL_ID,
			privilege: "DAV:read",
		})
		.withInstance({
			id: TEST_INSTANCE_ID,
			collectionId: TEST_COLLECTION_ID,
			entityId: TEST_ENTITY_ID,
			contentType: "text/calendar",
			etag: '"test-ical-etag"',
			slug: "event.ics",
		});

	// Seed the component tree via the PUT handler so we have real parsed content
	env.stores.components.set(TEST_ENTITY_ID, {
		name: "VCALENDAR",
		properties: [
			{
				name: "VERSION",
				parameters: [],
				value: { type: "TEXT", value: "2.0" },
				isKnown: true,
			},
			{
				name: "PRODID",
				parameters: [],
				value: { type: "TEXT", value: "-//Test//EN" },
				isKnown: true,
			},
		],
		components: [
			{
				name: "VEVENT",
				properties: [
					{
						name: "UID",
						parameters: [],
						value: { type: "TEXT", value: "test-event-uid@example.com" },
						isKnown: true,
					},
				],
				components: [],
			},
		],
	});

	return env;
};

const makeVCardEnv = () => {
	const env = makeTestEnv()
		.withUser({ principalId: TEST_PRINCIPAL_ID })
		.withCollection({
			id: TEST_COLLECTION_ID,
			ownerPrincipalId: TEST_PRINCIPAL_ID,
			collectionType: "addressbook",
		})
		.withAce({
			resourceType: "instance",
			resourceId: TEST_INSTANCE_ID,
			principalType: "principal",
			principalId: TEST_PRINCIPAL_ID,
			privilege: "DAV:read",
		})
		.withInstance({
			id: TEST_INSTANCE_ID,
			collectionId: TEST_COLLECTION_ID,
			entityId: TEST_ENTITY_ID,
			contentType: "text/vcard",
			etag: '"test-vcard-etag"',
			slug: "contact.vcf",
		});

	env.stores.components.set(TEST_ENTITY_ID, {
		name: "VCARD",
		properties: [
			{
				name: "VERSION",
				parameters: [],
				value: { type: "TEXT", value: "4.0" },
				isKnown: true,
			},
			{
				name: "FN",
				parameters: [],
				value: { type: "TEXT", value: "Test User" },
				isKnown: true,
			},
		],
		components: [],
	});

	return env;
};

// ---------------------------------------------------------------------------
// GET — iCalendar
// ---------------------------------------------------------------------------

describe("getHandler — iCalendar", () => {
	it("returns 200 with serialized iCalendar, Content-Type, ETag, and Last-Modified", async () => {
		const env = makeICalEnv();
		const res = await run(env, getHandler(instancePath, authenticatedCtx));

		expect(res.status).toBe(HTTP_OK);
		expect(res.headers.get("Content-Type")).toContain("text/calendar");
		expect(res.headers.get("ETag")).toBe('"test-ical-etag"');
		expect(res.headers.get("Last-Modified")).not.toBeNull();

		const body = await res.text();
		expect(body).toContain("BEGIN:VCALENDAR");
		expect(body).toContain("BEGIN:VEVENT");
	});
});

// ---------------------------------------------------------------------------
// GET — vCard
// ---------------------------------------------------------------------------

describe("getHandler — vCard", () => {
	it("returns 200 with serialized vCard and correct Content-Type", async () => {
		const env = makeVCardEnv();
		const path: ResolvedDavPath = {
			kind: "instance",
			principalId: TEST_PRINCIPAL_ID,
			namespace: "card",
			collectionId: TEST_COLLECTION_ID,
			instanceId: TEST_INSTANCE_ID,
			principalSeg: String(TEST_PRINCIPAL_ID),
			collectionSeg: String(TEST_COLLECTION_ID),
			instanceSeg: String(TEST_INSTANCE_ID),
		};
		const res = await run(env, getHandler(path, authenticatedCtx));

		expect(res.status).toBe(HTTP_OK);
		expect(res.headers.get("Content-Type")).toContain("text/vcard");

		const body = await res.text();
		expect(body).toContain("BEGIN:VCARD");
	});
});

// ---------------------------------------------------------------------------
// ETag consistency with PUT
// ---------------------------------------------------------------------------

describe("getHandler — ETag", () => {
	it("ETag on GET matches the ETag seeded from PUT", async () => {
		const env = makeICalEnv();
		const res = await run(env, getHandler(instancePath, authenticatedCtx));
		expect(res.headers.get("ETag")).toBe('"test-ical-etag"');
	});
});

// ---------------------------------------------------------------------------
// HEAD
// ---------------------------------------------------------------------------

describe("getHandler — HEAD", () => {
	it("HEAD returns same headers as GET but with no body", async () => {
		const env = makeICalEnv();

		const headRes = await run(env, getHandler(instancePath, headCtx));
		const getRes = await run(env, getHandler(instancePath, authenticatedCtx));

		expect(headRes.status).toBe(HTTP_OK);
		expect(headRes.headers.get("Content-Type")).toBe(
			getRes.headers.get("Content-Type"),
		);
		expect(headRes.headers.get("ETag")).toBe(getRes.headers.get("ETag"));
		expect(headRes.headers.get("Last-Modified")).toBe(
			getRes.headers.get("Last-Modified"),
		);
		expect(await headRes.text()).toBe("");
	});
});

// ---------------------------------------------------------------------------
// 405 for invalid path kinds
// ---------------------------------------------------------------------------

describe("getHandler — method not allowed", () => {
	it("returns 405 for kind: collection", async () => {
		const env = makeTestEnv();
		const path: ResolvedDavPath = {
			kind: "collection",
			principalId: TEST_PRINCIPAL_ID,
			namespace: "cal",
			collectionId: TEST_COLLECTION_ID,
			principalSeg: String(TEST_PRINCIPAL_ID),
			collectionSeg: String(TEST_COLLECTION_ID),
		};
		const err = (await runErr(
			env,
			getHandler(path, authenticatedCtx),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_METHOD_NOT_ALLOWED);
	});

	it("returns 405 for kind: principal", async () => {
		const env = makeTestEnv();
		const path: ResolvedDavPath = {
			kind: "principal",
			principalId: TEST_PRINCIPAL_ID,
			principalSeg: String(TEST_PRINCIPAL_ID),
		};
		const err = (await runErr(
			env,
			getHandler(path, authenticatedCtx),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_METHOD_NOT_ALLOWED);
	});

	it("returns 404 for kind: new-instance", async () => {
		const env = makeTestEnv();
		const path: ResolvedDavPath = {
			kind: "new-instance",
			principalId: TEST_PRINCIPAL_ID,
			namespace: "cal",
			collectionId: TEST_COLLECTION_ID,
			slug: "event.ics" as ReturnType<
				typeof import("#src/domain/types/path.ts").Slug
			>,
			principalSeg: String(TEST_PRINCIPAL_ID),
			collectionSeg: String(TEST_COLLECTION_ID),
		};
		const err = (await runErr(
			env,
			getHandler(path, authenticatedCtx),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_NOT_FOUND);
	});
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe("getHandler — authentication", () => {
	it("returns 401 for unauthenticated requests", async () => {
		const env = makeTestEnv();
		const err = (await runErr(
			env,
			getHandler(instancePath, unauthenticatedCtx),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_UNAUTHORIZED);
	});
});
