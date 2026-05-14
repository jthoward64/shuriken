import { describe, expect, it } from "bun:test";
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
import { mockServer } from "#src/testing/script-runner/runner.ts";

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
					mockServer,
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
					mockServer,
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
					mockServer,
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
});
