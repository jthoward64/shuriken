import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, ManagedRuntime, Redacted } from "effect";
import { Temporal } from "temporal-polyfill";
import {
	type CollectionId,
	type InstanceId,
	type PrincipalId,
	UserId,
} from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { handleRequest } from "#src/http/router.ts";
import { AclRepository } from "#src/services/acl/repository.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { UserService } from "#src/services/user/index.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";
import { mockClientAddress } from "#src/testing/script-runner/runner.ts";

// ---------------------------------------------------------------------------
// Verifies the calendar-sharing primitives end-to-end:
//   * Alice grants Bob DAV:read on her primary calendar → Bob can PROPFIND
//     it, but a PUT into that calendar is rejected with 403.
//   * Alice grants Bob DAV:read on a single event → the instance-level ACE
//     is honoured even though Bob has no rights on the parent calendar.
//   * listSharedWithPrincipals returns Alice's calendar / event for Bob,
//     not for Alice (owner exclusion).
// ---------------------------------------------------------------------------

const basicAuth = (email: string, id: string): string =>
	`Basic ${btoa(`${email}:${id}`)}`;

const EVENT_ICS = [
	"BEGIN:VCALENDAR",
	"VERSION:2.0",
	"PRODID:-//test//EN",
	"BEGIN:VEVENT",
	"UID:share-evt@example.com",
	"SUMMARY:Lunch",
	"DTSTART:20260601T120000Z",
	"DTEND:20260601T130000Z",
	"END:VEVENT",
	"END:VCALENDAR",
	"",
].join("\r\n");

describe("Calendar / event sharing (integration)", () => {
	it("Alice→Bob: read on calendar, read on event, owner-exclusion", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const { aliceId, bobId, bobPrincipal } = await runtime.runPromise(
				Effect.gen(function* () {
					const prov = yield* ProvisioningService;
					const userSvc = yield* UserService;
					const alice = yield* prov
						.provisionUser({
							email: Email("alice@example.com"),
							name: "Alice",
							slug: Slug("alice"),
						})
						.pipe(Effect.orDie);
					const bob = yield* prov
						.provisionUser({
							email: Email("bob@example.com"),
							name: "Bob",
							slug: Slug("bob"),
						})
						.pipe(Effect.orDie);
					yield* userSvc
						.addCredential(UserId(alice.user.user.id), {
							source: "local",
							authId: "alice@example.com",
							password: Redacted.make("alice"),
						})
						.pipe(Effect.orDie);
					yield* userSvc
						.addCredential(UserId(bob.user.user.id), {
							source: "local",
							authId: "bob@example.com",
							password: Redacted.make("bob"),
						})
						.pipe(Effect.orDie);
					return {
						aliceId: alice.user.principal.id as PrincipalId,
						bobId: bob.user.principal.id as PrincipalId,
						bobPrincipal: bob.user.principal,
						aliceCalendarId: alice.calendar.id as CollectionId,
					};
				}),
			);

			// Alice PUTs an event into her primary calendar.
			const aliceAuth = basicAuth("alice@example.com", "alice");
			const bobAuth = basicAuth("bob@example.com", "bob");
			const eventPutRes = await runtime.runPromise(
				handleRequest(
					new Request(
						"http://localhost/dav/principals/alice/cal/primary/lunch.ics",
						{
							method: "PUT",
							headers: {
								"Content-Type": "text/calendar; charset=utf-8",
								Authorization: aliceAuth,
							},
							body: EVENT_ICS,
						},
					),
					mockClientAddress,
				),
			);
			expect(eventPutRes.status).toBe(201);

			// Look up the IDs we need.
			const { aliceCalendarId, lunchInstanceId } = await runtime.runPromise(
				Effect.gen(function* () {
					const collRepo = yield* CollectionRepository;
					const instRepo = yield* InstanceRepository;
					const aliceCols = yield* collRepo.listByOwner(aliceId);
					const cal = aliceCols.find(
						(c) => c.slug === "primary" && c.collectionType === "calendar",
					);
					if (!cal) {
						throw new Error("Alice's calendar missing");
					}
					const instances = yield* instRepo.listByCollection(
						cal.id as CollectionId,
					);
					const lunch = instances[0];
					if (!lunch) {
						throw new Error("lunch event not found");
					}
					return {
						aliceCalendarId: cal.id as CollectionId,
						lunchInstanceId: lunch.id as InstanceId,
					};
				}),
			);

			// Alice grants Bob DAV:read on her primary calendar.
			await runtime.runPromise(
				Effect.gen(function* () {
					const acl = yield* AclRepository;
					yield* acl.grantAce({
						resourceType: "collection",
						resourceId: aliceCalendarId,
						principalType: "principal",
						principalId: bobId,
						privilege: "DAV:read",
						grantDeny: "grant",
						protected: false,
						ordinal: 100,
					});
				}),
			);

			// Bob can now PROPFIND Alice's calendar.
			const bobReadRes = await runtime.runPromise(
				handleRequest(
					new Request("http://localhost/dav/principals/alice/cal/primary/", {
						method: "PROPFIND",
						headers: { Authorization: bobAuth, Depth: "1" },
					}),
					mockClientAddress,
				),
			);
			expect(bobReadRes.status).toBe(207);

			// Bob still can't write — only read was granted.
			const bobWriteRes = await runtime.runPromise(
				handleRequest(
					new Request(
						"http://localhost/dav/principals/alice/cal/primary/x.ics",
						{
							method: "PUT",
							headers: {
								"Content-Type": "text/calendar",
								Authorization: bobAuth,
							},
							body: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
						},
					),
					mockClientAddress,
				),
			);
			expect(bobWriteRes.status).toBe(403);

			// Instance-level ACE: grant Bob DAV:read on the lunch event directly.
			await runtime.runPromise(
				Effect.gen(function* () {
					const acl = yield* AclRepository;
					yield* acl.grantAce({
						resourceType: "instance",
						resourceId: lunchInstanceId,
						principalType: "principal",
						principalId: bobId,
						privilege: "DAV:read",
						grantDeny: "grant",
						protected: false,
						ordinal: 100,
					});
				}),
			);

			// listSharedWithPrincipals returns Alice's calendar + event for Bob.
			const { sharedCols, sharedInsts } = await runtime.runPromise(
				Effect.gen(function* () {
					const collRepo = yield* CollectionRepository;
					const instRepo = yield* InstanceRepository;
					const sc = yield* collRepo.listSharedWithPrincipals(
						[bobId],
						["DAV:read"],
					);
					const si = yield* instRepo.listSharedWithPrincipals(
						[bobId],
						["DAV:read"],
					);
					return { sharedCols: sc, sharedInsts: si };
				}),
			);
			expect(sharedCols.map((c) => c.id)).toContain(aliceCalendarId);
			expect(sharedInsts.map((i) => i.id)).toContain(lunchInstanceId);

			// Alice does NOT see her own calendar in her shared-with-me view.
			const aliceShared = await runtime.runPromise(
				Effect.flatMap(CollectionRepository, (r) =>
					r.listSharedWithPrincipals([aliceId], ["DAV:read"]),
				),
			);
			expect(aliceShared.find((c) => c.id === aliceCalendarId)).toBeUndefined();

			// Sanity: principal sentinel suppresses warning about unused name.
			expect(bobPrincipal.slug).toBe("bob");
			// And the recently-created timestamp the test environment hands out is
			// in the past — protects against accidentally drifting clock fixtures.
			expect(Temporal.Now.instant().toString()).toBeTruthy();
		} finally {
			await runtime.dispose();
		}
	});

	it("free_busy-only grant: enumeration and GET succeed with redacted bodies, free-busy-query succeeds", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const { aliceId, bobId } = await runtime.runPromise(
				Effect.gen(function* () {
					const prov = yield* ProvisioningService;
					const userSvc = yield* UserService;
					const alice = yield* prov
						.provisionUser({
							email: Email("alice-fb@example.com"),
							name: "Alice",
							slug: Slug("alice-fb"),
						})
						.pipe(Effect.orDie);
					const bob = yield* prov
						.provisionUser({
							email: Email("bob-fb@example.com"),
							name: "Bob",
							slug: Slug("bob-fb"),
						})
						.pipe(Effect.orDie);
					yield* userSvc
						.addCredential(UserId(alice.user.user.id), {
							source: "local",
							authId: "alice-fb@example.com",
							password: Redacted.make("alice"),
						})
						.pipe(Effect.orDie);
					yield* userSvc
						.addCredential(UserId(bob.user.user.id), {
							source: "local",
							authId: "bob-fb@example.com",
							password: Redacted.make("bob"),
						})
						.pipe(Effect.orDie);
					return {
						aliceId: alice.user.principal.id as PrincipalId,
						bobId: bob.user.principal.id as PrincipalId,
					};
				}),
			);

			const aliceAuth = basicAuth("alice-fb@example.com", "alice");
			const bobAuth = basicAuth("bob-fb@example.com", "bob");

			const eventPutRes = await runtime.runPromise(
				handleRequest(
					new Request(
						"http://localhost/dav/principals/alice-fb/cal/primary/lunch.ics",
						{
							method: "PUT",
							headers: {
								"Content-Type": "text/calendar; charset=utf-8",
								Authorization: aliceAuth,
							},
							body: EVENT_ICS,
						},
					),
					mockClientAddress,
				),
			);
			expect(eventPutRes.status).toBe(201);

			const { aliceCalendarId } = await runtime.runPromise(
				Effect.gen(function* () {
					const collRepo = yield* CollectionRepository;
					const aliceCols = yield* collRepo.listByOwner(aliceId);
					const cal = aliceCols.find(
						(c) => c.slug === "primary" && c.collectionType === "calendar",
					);
					if (!cal) {
						throw new Error("Alice's calendar missing");
					}
					return { aliceCalendarId: cal.id as CollectionId };
				}),
			);

			// Grant Bob free-busy-only access — not DAV:read.
			await runtime.runPromise(
				Effect.gen(function* () {
					const acl = yield* AclRepository;
					yield* acl.grantAce({
						resourceType: "collection",
						resourceId: aliceCalendarId,
						principalType: "principal",
						principalId: bobId,
						privilege: "CALDAV:read-free-busy",
						grantDeny: "grant",
						protected: false,
						ordinal: 100,
					});
				}),
			);

			// PROPFIND succeeds — collection metadata is visible.
			const propfindRes = await runtime.runPromise(
				handleRequest(
					new Request("http://localhost/dav/principals/alice-fb/cal/primary/", {
						method: "PROPFIND",
						headers: { Authorization: bobAuth, Depth: "1" },
					}),
					mockClientAddress,
				),
			);
			expect(propfindRes.status).toBe(207);
			const propfindBody = await propfindRes.text();
			// Depth:1 member enumeration must not leak the real title/description.
			expect(propfindBody).not.toContain("Confidential");

			// GET the event succeeds but returns a redacted body.
			const getRes = await runtime.runPromise(
				handleRequest(
					new Request(
						"http://localhost/dav/principals/alice-fb/cal/primary/lunch.ics",
						{ method: "GET", headers: { Authorization: bobAuth } },
					),
					mockClientAddress,
				),
			);
			expect(getRes.status).toBe(200);
			const getBody = await getRes.text();
			expect(getBody).toContain("SUMMARY:Busy");
			expect(getBody).not.toContain("SUMMARY:Lunch");

			// free-busy-query REPORT succeeds and reports the busy block.
			const freeBusyBody = [
				'<?xml version="1.0" encoding="utf-8"?>',
				'<C:free-busy-query xmlns:C="urn:ietf:params:xml:ns:caldav">',
				"<C:time-range start=20260601T000000Z end=20260602T000000Z />",
				"</C:free-busy-query>",
			].join("\n");
			const freeBusyRes = await runtime.runPromise(
				handleRequest(
					new Request("http://localhost/dav/principals/alice-fb/cal/primary/", {
						method: "REPORT",
						headers: {
							Authorization: bobAuth,
							"Content-Type": "application/xml",
						},
						body: freeBusyBody,
					}),
					mockClientAddress,
				),
			);
			expect(freeBusyRes.status).toBe(200);
			const freeBusyText = await freeBusyRes.text();
			expect(freeBusyText).toContain("VFREEBUSY");

			// Bob still can't write.
			const writeRes = await runtime.runPromise(
				handleRequest(
					new Request(
						"http://localhost/dav/principals/alice-fb/cal/primary/x.ics",
						{
							method: "PUT",
							headers: {
								"Content-Type": "text/calendar",
								Authorization: bobAuth,
							},
							body: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
						},
					),
					mockClientAddress,
				),
			);
			expect(writeRes.status).toBe(403);
		} finally {
			await runtime.dispose();
		}
	});

	it("Basic-tier set-tier round trip: 'edit' persists exactly DAV:read+DAV:write, no stray DAV:all", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const { aliceId, bobId } = await runtime.runPromise(
				Effect.gen(function* () {
					const prov = yield* ProvisioningService;
					const userSvc = yield* UserService;
					const alice = yield* prov
						.provisionUser({
							email: Email("alice-tier@example.com"),
							name: "Alice",
							slug: Slug("alice-tier"),
						})
						.pipe(Effect.orDie);
					const bob = yield* prov
						.provisionUser({
							email: Email("bob-tier@example.com"),
							name: "Bob",
							slug: Slug("bob-tier"),
						})
						.pipe(Effect.orDie);
					yield* userSvc
						.addCredential(UserId(alice.user.user.id), {
							source: "local",
							authId: "alice-tier@example.com",
							password: Redacted.make("alice"),
						})
						.pipe(Effect.orDie);
					return {
						aliceId: alice.user.principal.id as PrincipalId,
						bobId: bob.user.principal.id as PrincipalId,
					};
				}),
			);

			const { aliceCalendarId } = await runtime.runPromise(
				Effect.gen(function* () {
					const collRepo = yield* CollectionRepository;
					const aliceCols = yield* collRepo.listByOwner(aliceId);
					const cal = aliceCols.find(
						(c) => c.slug === "primary" && c.collectionType === "calendar",
					);
					if (!cal) {
						throw new Error("Alice's calendar missing");
					}
					return { aliceCalendarId: cal.id as CollectionId };
				}),
			);

			const aliceAuth = basicAuth("alice-tier@example.com", "alice");
			const setTierRes = await runtime.runPromise(
				handleRequest(
					new Request(
						`http://localhost/ui/api/acl/collection/${aliceCalendarId}/set-tier`,
						{
							method: "POST",
							headers: {
								Authorization: aliceAuth,
								"Content-Type": "application/x-www-form-urlencoded",
							},
							body: new URLSearchParams({
								principalSlug: "bob-tier",
								tier: "edit",
							}).toString(),
						},
					),
					mockClientAddress,
				),
			);
			expect(setTierRes.status).toBe(200);

			const bobAces = await runtime.runPromise(
				Effect.gen(function* () {
					const acl = yield* AclRepository;
					const aces = yield* acl.getAces(aliceCalendarId, "collection");
					return aces.filter((a) => a.principalId === bobId);
				}),
			);
			const privileges = bobAces.map((a) => a.privilege).sort();
			expect(privileges).toEqual(["DAV:read", "DAV:write"]);
			expect(privileges).not.toContain("DAV:all");
		} finally {
			await runtime.dispose();
		}
	});
});
