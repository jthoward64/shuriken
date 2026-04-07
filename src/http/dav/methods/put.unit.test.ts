import { describe, expect, it } from "bun:test";
import { Effect, Option } from "effect";
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
	Unauthenticated,
} from "#src/domain/types/dav.ts";
import type { ResolvedDavPath } from "#src/domain/types/path.ts";
import { Slug } from "#src/domain/types/path.ts";
import type { HttpRequestContext } from "#src/http/context.ts";
import {
	HTTP_CREATED,
	HTTP_METHOD_NOT_ALLOWED,
	HTTP_NO_CONTENT,
	HTTP_PRECONDITION_FAILED,
	HTTP_UNSUPPORTED_MEDIA_TYPE,
} from "#src/http/status.ts";
import type { AclService } from "#src/services/acl/index.ts";
import type { ComponentRepository } from "#src/services/component/index.ts";
import type { EntityRepository } from "#src/services/entity/index.ts";
import type { InstanceService } from "#src/services/instance/index.ts";
import type { CalTimezoneRepository } from "#src/services/timezone/index.ts";
import { runFailure, runSuccess } from "#src/testing/effect.ts";
import { makeTestEnv } from "#src/testing/env.ts";
import { putHandler } from "./put.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_PRINCIPAL_ID = PrincipalId("00000000-0000-0000-0000-000000000001");
const TEST_USER_ID = UserId("00000000-0000-0000-0000-000000000002");
const TEST_COLLECTION_ID = CollectionId("00000000-0000-0000-0000-000000000003");
const TEST_INSTANCE_ID = InstanceId("00000000-0000-0000-0000-000000000004");

const authenticatedPrincipal: AuthenticatedPrincipal = {
	principalId: TEST_PRINCIPAL_ID,
	userId: TEST_USER_ID,
	displayName: "Test User",
};

const makeCtx = (
	auth: HttpRequestContext["auth"],
	method = "PUT",
): HttpRequestContext => ({
	requestId: RequestId("test-request-id"),
	method,
	url: new URL(
		`http://localhost/dav/principals/${TEST_PRINCIPAL_ID}/cal/${TEST_COLLECTION_ID}/event.ics`,
	),
	headers: new Headers(),
	auth,
	clientIp: Option.none(),
});


const authenticatedCtx = makeCtx(
	new Authenticated({ principal: authenticatedPrincipal }),
);
const unauthenticatedCtx = makeCtx(new Unauthenticated());

const makeNewInstancePath = (
	namespace: "cal" | "card" | "col" = "cal",
): ResolvedDavPath => ({
	kind: "new-instance",
	principalId: TEST_PRINCIPAL_ID,
	namespace,
	collectionId: TEST_COLLECTION_ID,
	slug: Slug("event.ics"),
	principalSeg: String(TEST_PRINCIPAL_ID),
	collectionSeg: String(TEST_COLLECTION_ID),
});

const makeInstancePath = (
	namespace: "cal" | "card" | "col" = "cal",
): ResolvedDavPath => ({
	kind: "instance",
	principalId: TEST_PRINCIPAL_ID,
	namespace,
	collectionId: TEST_COLLECTION_ID,
	instanceId: TEST_INSTANCE_ID,
	principalSeg: String(TEST_PRINCIPAL_ID),
	collectionSeg: String(TEST_COLLECTION_ID),
	instanceSeg: String(TEST_INSTANCE_ID),
});

// Minimal valid iCalendar
const ICAL_BODY =
	"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\nUID:test-event-uid@example.com\r\nDTSTAMP:20240101T000000Z\r\nDTSTART:20240101T120000Z\r\nSUMMARY:Test Event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

// iCalendar with one VTIMEZONE (TZID: America/New_York)
const ICAL_BODY_WITH_VTIMEZONE =
	"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
	"BEGIN:VTIMEZONE\r\nTZID:America/New_York\r\n" +
	"BEGIN:STANDARD\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\n" +
	"DTSTART:19671029T020000\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n" +
	"BEGIN:VEVENT\r\nUID:tz-event@example.com\r\nDTSTAMP:20240101T000000Z\r\n" +
	"DTSTART;TZID=America/New_York:20240101T120000\r\nSUMMARY:TZ Event\r\nEND:VEVENT\r\n" +
	"END:VCALENDAR\r\n";

// iCalendar with two VTIMEZONEs
const ICAL_BODY_WITH_TWO_VTIMEZONES =
	"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\n" +
	"BEGIN:VTIMEZONE\r\nTZID:America/New_York\r\n" +
	"BEGIN:STANDARD\r\nTZOFFSETFROM:-0400\r\nTZOFFSETTO:-0500\r\n" +
	"DTSTART:19671029T020000\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n" +
	"BEGIN:VTIMEZONE\r\nTZID:Europe/London\r\n" +
	"BEGIN:STANDARD\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0000\r\n" +
	"DTSTART:19961027T010000\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n" +
	"BEGIN:VEVENT\r\nUID:multi-tz@example.com\r\nDTSTAMP:20240101T000000Z\r\n" +
	"DTSTART;TZID=America/New_York:20240101T120000\r\nSUMMARY:Multi-TZ\r\nEND:VEVENT\r\n" +
	"END:VCALENDAR\r\n";

// Minimal valid iCalendar with different content (for ETag-change test)
const ICAL_BODY_2 =
	"BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//EN\r\nBEGIN:VEVENT\r\nUID:test-event-uid-2@example.com\r\nDTSTAMP:20240101T000000Z\r\nDTSTART:20240102T120000Z\r\nSUMMARY:Updated Event\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

// Minimal valid vCard
const VCARD_BODY =
	"BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Test User\r\nUID:urn:uuid:4fbe8971-0bc3-424c-9c26-36c3e1eff6b1\r\nEND:VCARD\r\n";

const makeICalRequest = (body = ICAL_BODY, extraHeaders?: Record<string, string>) =>
	new Request("http://localhost/", {
		method: "PUT",
		body,
		headers: { "Content-Type": "text/calendar", ...extraHeaders },
	});

const makeVCardRequest = (body = VCARD_BODY) =>
	new Request("http://localhost/", {
		method: "PUT",
		body,
		headers: { "Content-Type": "text/vcard" },
	});

/**
 * Base test env: user + calendar collection + write-content ACE on the
 * collection (for new-instance) and on the instance (for existing-instance).
 */
const makeEnv = () =>
	makeTestEnv()
		.withUser({ principalId: TEST_PRINCIPAL_ID })
		.withCollection({
			id: TEST_COLLECTION_ID,
			ownerPrincipalId: TEST_PRINCIPAL_ID,
			collectionType: "calendar",
		})
		.withAce({
			resourceType: "collection",
			resourceId: TEST_COLLECTION_ID,
			principalType: "principal",
			principalId: TEST_PRINCIPAL_ID,
			privilege: "DAV:write-content",
		})
		.withAce({
			resourceType: "instance",
			resourceId: TEST_INSTANCE_ID,
			principalType: "principal",
			principalId: TEST_PRINCIPAL_ID,
			privilege: "DAV:write-content",
		});

type PutEffect<A> = Effect.Effect<
	A,
	DavError | DatabaseError,
	AclService | InstanceService | ComponentRepository | EntityRepository | CalTimezoneRepository
>;
type PutFailEffect = Effect.Effect<
	unknown,
	DavError | DatabaseError,
	AclService | InstanceService | ComponentRepository | EntityRepository | CalTimezoneRepository
>;

const run = <A>(env: ReturnType<typeof makeTestEnv>, effect: PutEffect<A>) =>
	runSuccess(effect.pipe(Effect.provide(env.toLayer()), Effect.orDie));

const runErr = (env: ReturnType<typeof makeTestEnv>, effect: PutFailEffect) =>
	runFailure(effect.pipe(Effect.provide(env.toLayer())));

// ---------------------------------------------------------------------------
// Create new instance
// ---------------------------------------------------------------------------

describe("putHandler — new-instance (create)", () => {
	it("creates a new iCalendar instance and returns 201 with ETag", async () => {
		const env = makeEnv();
		const res = await run(
			env,
			putHandler(makeNewInstancePath(), authenticatedCtx, makeICalRequest()),
		);
		expect(res.status).toBe(HTTP_CREATED);
		expect(res.headers.get("ETag")).not.toBeNull();
	});

	it("creates a new vCard instance and returns 201 with ETag", async () => {
		const env = makeEnv().withCollection({
			id: TEST_COLLECTION_ID,
			ownerPrincipalId: TEST_PRINCIPAL_ID,
			collectionType: "addressbook",
		});
		const res = await run(
			env,
			putHandler(makeNewInstancePath("card"), authenticatedCtx, makeVCardRequest()),
		);
		expect(res.status).toBe(HTTP_CREATED);
		expect(res.headers.get("ETag")).not.toBeNull();
	});

	it("If-Match on a new-instance path returns 412", async () => {
		const env = makeEnv();
		const err = (await runErr(
			env,
			putHandler(
				makeNewInstancePath(),
				authenticatedCtx,
				makeICalRequest(ICAL_BODY, { "If-Match": '"some-etag"' }),
			),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_PRECONDITION_FAILED);
	});
});

// ---------------------------------------------------------------------------
// Update existing instance
// ---------------------------------------------------------------------------

describe("putHandler — instance (update)", () => {
	it("updates an existing instance and returns 204 with ETag", async () => {
		const env = makeEnv().withInstance({
			id: TEST_INSTANCE_ID,
			collectionId: TEST_COLLECTION_ID,
			contentType: "text/calendar",
			etag: '"old-etag"',
			slug: "event.ics",
		});
		const res = await run(
			env,
			putHandler(makeInstancePath(), authenticatedCtx, makeICalRequest()),
		);
		expect(res.status).toBe(HTTP_NO_CONTENT);
		expect(res.headers.get("ETag")).not.toBeNull();
	});

	it("ETag changes when content changes between two PUTs", async () => {
		const env = makeEnv().withInstance({
			id: TEST_INSTANCE_ID,
			collectionId: TEST_COLLECTION_ID,
			contentType: "text/calendar",
			etag: '"old-etag"',
			slug: "event.ics",
		});

		const res1 = await run(
			env,
			putHandler(makeInstancePath(), authenticatedCtx, makeICalRequest(ICAL_BODY)),
		);
		const etag1 = res1.headers.get("ETag");

		// Seed the updated etag so the second PUT sees it
		const instances = [...env.stores.instances.values()];
		const instance = instances[0];
		if (instance) {
			env.stores.instances.set(instance.id, { ...instance, etag: etag1 ?? instance.etag });
		}

		const res2 = await run(
			env,
			putHandler(makeInstancePath(), authenticatedCtx, makeICalRequest(ICAL_BODY_2)),
		);
		const etag2 = res2.headers.get("ETag");

		expect(etag1).not.toBeNull();
		expect(etag2).not.toBeNull();
		expect(etag1).not.toBe(etag2);
	});

	it("If-Match mismatch returns 412", async () => {
		const env = makeEnv().withInstance({
			id: TEST_INSTANCE_ID,
			collectionId: TEST_COLLECTION_ID,
			contentType: "text/calendar",
			etag: '"current-etag"',
			slug: "event.ics",
		});
		const err = (await runErr(
			env,
			putHandler(
				makeInstancePath(),
				authenticatedCtx,
				makeICalRequest(ICAL_BODY, { "If-Match": '"wrong-etag"' }),
			),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_PRECONDITION_FAILED);
	});

	it("If-None-Match: * on an existing resource returns 412", async () => {
		const env = makeEnv().withInstance({
			id: TEST_INSTANCE_ID,
			collectionId: TEST_COLLECTION_ID,
			contentType: "text/calendar",
			etag: '"current-etag"',
			slug: "event.ics",
		});
		const err = (await runErr(
			env,
			putHandler(
				makeInstancePath(),
				authenticatedCtx,
				makeICalRequest(ICAL_BODY, { "If-None-Match": "*" }),
			),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_PRECONDITION_FAILED);
	});
});

// ---------------------------------------------------------------------------
// Content-Type validation
// ---------------------------------------------------------------------------

describe("putHandler — content-type validation", () => {
	it("rejects an unsupported content type with 415", async () => {
		const env = makeEnv();
		const req = new Request("http://localhost/", {
			method: "PUT",
			body: "not calendar data",
			headers: { "Content-Type": "text/plain" },
		});
		const err = (await runErr(
			env,
			putHandler(makeNewInstancePath(), authenticatedCtx, req),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_UNSUPPORTED_MEDIA_TYPE);
		expect(err.precondition).toBe("CALDAV:supported-calendar-data");
	});

	it("uses CARDDAV:supported-address-data precondition for card namespace", async () => {
		const env = makeEnv().withAce({
			resourceType: "collection",
			resourceId: TEST_COLLECTION_ID,
			principalType: "principal",
			principalId: TEST_PRINCIPAL_ID,
			privilege: "DAV:write-content",
		});
		const req = new Request("http://localhost/", {
			method: "PUT",
			body: "not vcard data",
			headers: { "Content-Type": "text/plain" },
		});
		const err = (await runErr(
			env,
			putHandler(makeNewInstancePath("card"), authenticatedCtx, req),
		)) as DavError;
		expect(err.status).toBe(HTTP_UNSUPPORTED_MEDIA_TYPE);
		expect(err.precondition).toBe("CARDDAV:supported-address-data");
	});
});

// ---------------------------------------------------------------------------
// Parse errors
// ---------------------------------------------------------------------------

describe("putHandler — parse errors", () => {
	it("rejects invalid iCalendar with 400 + CALDAV:valid-calendar-data", async () => {
		const env = makeEnv();
		const req = new Request("http://localhost/", {
			method: "PUT",
			body: "BEGIN:NOTCALENDAR\r\nEND:NOTCALENDAR\r\n",
			headers: { "Content-Type": "text/calendar" },
		});
		const err = (await runErr(
			env,
			putHandler(makeNewInstancePath(), authenticatedCtx, req),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.precondition).toBe("CALDAV:valid-calendar-data");
	});

	it("rejects invalid vCard with 400 + CARDDAV:valid-address-data", async () => {
		const env = makeEnv();
		const req = new Request("http://localhost/", {
			method: "PUT",
			body: "BEGIN:NOTACARD\r\nEND:NOTACARD\r\n",
			headers: { "Content-Type": "text/vcard" },
		});
		const err = (await runErr(
			env,
			putHandler(makeNewInstancePath("card"), authenticatedCtx, req),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.precondition).toBe("CARDDAV:valid-address-data");
	});
});

// ---------------------------------------------------------------------------
// 405 for invalid path kinds
// ---------------------------------------------------------------------------

describe("putHandler — method not allowed", () => {
	it("returns 405 for kind: collection", async () => {
		const env = makeEnv();
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
			putHandler(path, authenticatedCtx, makeICalRequest()),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_METHOD_NOT_ALLOWED);
	});

	it("returns 405 for kind: principal", async () => {
		const env = makeEnv();
		const path: ResolvedDavPath = {
			kind: "principal",
			principalId: TEST_PRINCIPAL_ID,
			principalSeg: String(TEST_PRINCIPAL_ID),
		};
		const err = (await runErr(
			env,
			putHandler(path, unauthenticatedCtx, makeICalRequest()),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.status).toBe(HTTP_METHOD_NOT_ALLOWED);
	});
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe("putHandler — authentication", () => {
	it("returns 403 need-privileges for unauthenticated requests", async () => {
		const env = makeEnv();
		const err = (await runErr(
			env,
			putHandler(makeNewInstancePath(), unauthenticatedCtx, makeICalRequest()),
		)) as DavError;
		expect(err._tag).toBe("DavError");
		expect(err.precondition).toBe("DAV:need-privileges");
	});
});

// ---------------------------------------------------------------------------
// VTIMEZONE / cal_timezone upsert
// ---------------------------------------------------------------------------

describe("putHandler — cal_timezone upsert", () => {
	it("upserts VTIMEZONE into cal_timezone when iCalendar contains one", async () => {
		const env = makeEnv();
		await run(
			env,
			putHandler(
				makeNewInstancePath(),
				authenticatedCtx,
				new Request("http://localhost/", {
					method: "PUT",
					body: ICAL_BODY_WITH_VTIMEZONE,
					headers: { "Content-Type": "text/calendar" },
				}),
			),
		);
		expect(env.stores.calTimezones.size).toBe(1);
		expect(env.stores.calTimezones.has("America/New_York")).toBe(true);
	});

	it("upserts all VTIMEZONEs when iCalendar contains more than one", async () => {
		const env = makeEnv();
		await run(
			env,
			putHandler(
				makeNewInstancePath(),
				authenticatedCtx,
				new Request("http://localhost/", {
					method: "PUT",
					body: ICAL_BODY_WITH_TWO_VTIMEZONES,
					headers: { "Content-Type": "text/calendar" },
				}),
			),
		);
		expect(env.stores.calTimezones.size).toBe(2);
		expect(env.stores.calTimezones.has("America/New_York")).toBe(true);
		expect(env.stores.calTimezones.has("Europe/London")).toBe(true);
	});

	it("does not upsert anything when iCalendar has no VTIMEZONE", async () => {
		const env = makeEnv();
		await run(
			env,
			putHandler(makeNewInstancePath(), authenticatedCtx, makeICalRequest()),
		);
		expect(env.stores.calTimezones.size).toBe(0);
	});

	it("does not upsert anything for a vCard PUT", async () => {
		const env = makeEnv().withCollection({
			id: TEST_COLLECTION_ID,
			ownerPrincipalId: TEST_PRINCIPAL_ID,
			collectionType: "addressbook",
		});
		await run(
			env,
			putHandler(makeNewInstancePath("card"), authenticatedCtx, makeVCardRequest()),
		);
		expect(env.stores.calTimezones.size).toBe(0);
	});
});
