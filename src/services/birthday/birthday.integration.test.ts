import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, ManagedRuntime, Redacted } from "effect";
import { CollectionId, type PrincipalId, UserId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { handleRequest } from "#src/http/router.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { UserService } from "#src/services/user/index.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";
import { mockClientAddress } from "#src/testing/script-runner/runner.ts";
import { BirthdayService } from "./service.ts";

// ---------------------------------------------------------------------------
// End-to-end: provision a user (which auto-creates the auto-managed
// "Birthdays" calendar), PUT a vCard with BDAY into the primary addressbook,
// invoke BirthdayService.regenerate, then verify a VEVENT was emitted into
// the Birthdays collection and that further DAV mutations on it are
// rejected (read-only).
// ---------------------------------------------------------------------------

const VCARD_WITH_BDAY = [
	"BEGIN:VCARD",
	"VERSION:4.0",
	"UID:contact-bob",
	"FN:Bob Builder",
	"BDAY:19850412",
	"END:VCARD",
	"",
].join("\r\n");

const VCARD_REPLACE_NO_BDAY = [
	"BEGIN:VCARD",
	"VERSION:4.0",
	"UID:contact-bob",
	"FN:Bob Builder",
	"END:VCARD",
	"",
].join("\r\n");

const basicAuthHeader = (email: string, id: string): string =>
	`Basic ${btoa(`${email}:${id}`)}`;

describe("Birthday calendar (integration)", () => {
	it("regenerates VEVENT from a BDAY-bearing vCard and enforces read-only", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			// 1. Provision user — also creates the auto-managed Birthdays calendar.
			const provisioned = await runtime.runPromise(
				Effect.gen(function* () {
					const provisioning = yield* ProvisioningService;
					const userSvc = yield* UserService;
					const p = yield* provisioning
						.provisionUser({
							email: Email("alice@example.com"),
							name: "Alice",
							slug: Slug("alice"),
						})
						.pipe(Effect.orDie);
					yield* userSvc
						.addCredential(UserId(p.user.user.id), {
							source: "local",
							authId: "alice@example.com",
							password: Redacted.make("alice"),
						})
						.pipe(Effect.orDie);
					return p;
				}),
			);
			const principalId = provisioned.user.principal.id as PrincipalId;

			// 2. PUT a vCard with BDAY into the primary addressbook.
			const auth = basicAuthHeader("alice@example.com", "alice");
			const putReq = new Request(
				"http://localhost/dav/principals/alice/card/primary/bob.vcf",
				{
					method: "PUT",
					headers: {
						"Content-Type": "text/vcard; charset=utf-8",
						Authorization: auth,
					},
					body: VCARD_WITH_BDAY,
				},
			);
			const putRes = await runtime.runPromise(
				handleRequest(putReq, mockClientAddress),
			);
			expect(putRes.status).toBe(201);

			// 3. Look up the Birthdays collection by auto_managed_kind.
			const birthdayCollectionId = await runtime.runPromise(
				Effect.gen(function* () {
					const collRepo = yield* CollectionRepository;
					const all = yield* collRepo.listByAutoManagedKind("birthdays");
					const mine = all.find((c) => c.ownerPrincipalId === principalId);
					if (!mine) {
						throw new Error("Birthdays collection not provisioned");
					}
					return CollectionId(mine.id);
				}),
			);

			// 4. Run the generator. Expect one VEVENT inserted.
			const result1 = await runtime.runPromise(
				Effect.flatMap(BirthdayService, (b) =>
					b.regenerate(principalId, birthdayCollectionId),
				),
			);
			expect(result1).toEqual({ inserted: 1, updated: 0, deleted: 0 });

			// 5. PROPFIND the Birthdays calendar — depth:1 should list two
			//    <D:response> elements (the collection itself + the new
			//    derived instance). The instance hrefs are UUIDs by project
			//    convention, so we verify shape rather than slug.
			const propfindReq = new Request(
				"http://localhost/dav/principals/alice/cal/birthdays/",
				{
					method: "PROPFIND",
					headers: { Authorization: auth, Depth: "1" },
				},
			);
			const propfindRes = await runtime.runPromise(
				handleRequest(propfindReq, mockClientAddress),
			);
			expect(propfindRes.status).toBe(207);
			const propfindBody = await propfindRes.text();
			const responseCount = (propfindBody.match(/<D:response>/g) ?? []).length;
			expect(responseCount).toBe(2);
			expect(propfindBody).toContain("text/calendar");

			// 5b. current-user-privilege-set must advertise the Birthdays calendar
			//     (and its derived instance) as read-only so clients don't offer an
			//     edit that will 403. Content-write privileges are stripped; read
			//     and write-properties (local rename/recolor) are retained.
			expect(propfindBody).toContain("<D:read/>");
			expect(propfindBody).toContain("<D:write-properties/>");
			expect(propfindBody).not.toContain("<D:write/>");
			expect(propfindBody).not.toContain("<D:write-content/>");
			expect(propfindBody).not.toContain("<D:bind/>");
			expect(propfindBody).not.toContain("<D:unbind/>");

			// Contrast: a normal (writable) calendar still advertises write, so the
			// stripping above is specific to read-only collections, not global.
			const primaryReq = new Request(
				"http://localhost/dav/principals/alice/cal/primary/",
				{ method: "PROPFIND", headers: { Authorization: auth, Depth: "0" } },
			);
			const primaryRes = await runtime.runPromise(
				handleRequest(primaryReq, mockClientAddress),
			);
			expect(primaryRes.status).toBe(207);
			const primaryBody = await primaryRes.text();
			expect(primaryBody).toContain("<D:write/>");
			expect(primaryBody).toContain("<D:bind/>");

			// 6. Read-only enforcement: PUT to the Birthdays collection must
			//    be rejected with 403.
			const writeAttempt = new Request(
				"http://localhost/dav/principals/alice/cal/birthdays/custom.ics",
				{
					method: "PUT",
					headers: { "Content-Type": "text/calendar", Authorization: auth },
					body: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
				},
			);
			const writeRes = await runtime.runPromise(
				handleRequest(writeAttempt, mockClientAddress),
			);
			expect(writeRes.status).toBe(403);

			// 7. Idempotency: a second regen with no card changes is a no-op.
			const result2 = await runtime.runPromise(
				Effect.flatMap(BirthdayService, (b) =>
					b.regenerate(principalId, birthdayCollectionId),
				),
			);
			expect(result2).toEqual({ inserted: 0, updated: 0, deleted: 0 });

			// 8. Removing the BDAY from the vCard should cause the next regen
			//    to delete the derived VEVENT.
			const replaceReq = new Request(
				"http://localhost/dav/principals/alice/card/primary/bob.vcf",
				{
					method: "PUT",
					headers: {
						"Content-Type": "text/vcard; charset=utf-8",
						Authorization: auth,
					},
					body: VCARD_REPLACE_NO_BDAY,
				},
			);
			const replaceRes = await runtime.runPromise(
				handleRequest(replaceReq, mockClientAddress),
			);
			expect([200, 204]).toContain(replaceRes.status);

			const result3 = await runtime.runPromise(
				Effect.flatMap(BirthdayService, (b) =>
					b.regenerate(principalId, birthdayCollectionId),
				),
			);
			expect(result3).toEqual({ inserted: 0, updated: 0, deleted: 1 });
		} finally {
			await runtime.dispose();
		}
	});
});
