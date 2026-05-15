import { describe, expect, it } from "bun:test";
import { Effect, ManagedRuntime, Redacted } from "effect";
import {
	type CollectionId,
	type PrincipalId,
	UserId,
} from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { UserService } from "#src/services/user/index.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";
import { ImipInboundService } from "./inbound.ts";

// ---------------------------------------------------------------------------
// End-to-end inbound iMIP:
//   * REQUEST for a brand-new UID lands in the recipient's primary calendar
//   * REQUEST for the same UID updates the existing event
//   * CANCEL removes it
//   * UnknownRecipient outcome when no user matches the To address
// ---------------------------------------------------------------------------

const REQUEST_BODY = (uid: string, summary: string) =>
	[
		"From: organizer@remote.example",
		"To: alice@example.com",
		"Subject: Invitation",
		"Content-Type: text/calendar; method=REQUEST; charset=utf-8",
		"",
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//remote//EN",
		"METHOD:REQUEST",
		"BEGIN:VEVENT",
		`UID:${uid}`,
		`SUMMARY:${summary}`,
		"DTSTART:20260601T120000Z",
		"DTEND:20260601T130000Z",
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");

const CANCEL_BODY = (uid: string) =>
	[
		"From: organizer@remote.example",
		"To: alice@example.com",
		"Subject: Cancelled",
		"Content-Type: text/calendar; method=CANCEL; charset=utf-8",
		"",
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//remote//EN",
		"METHOD:CANCEL",
		"BEGIN:VEVENT",
		`UID:${uid}`,
		"SUMMARY:Cancelled meeting",
		"DTSTART:20260601T120000Z",
		"END:VEVENT",
		"END:VCALENDAR",
	].join("\r\n");

describe("ImipInboundService (integration)", () => {
	it("REQUEST → updates existing → CANCEL → unknown recipient", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const { aliceCal } = await runtime.runPromise(
				Effect.gen(function* () {
					const prov = yield* ProvisioningService;
					const userSvc = yield* UserService;
					const a = yield* prov
						.provisionUser({
							email: Email("alice@example.com"),
							name: "Alice",
							slug: Slug("alice"),
						})
						.pipe(Effect.orDie);
					yield* userSvc
						.addCredential(UserId(a.user.user.id), {
							source: "local",
							authId: "alice@example.com",
							password: Redacted.make("alice"),
						})
						.pipe(Effect.orDie);
					return {
						aliceId: a.user.principal.id as PrincipalId,
						aliceCal: a.calendar.id as CollectionId,
					};
				}),
			);

			const inbound = (body: string, to: string) =>
				Effect.flatMap(ImipInboundService, (s) =>
					s.process({ recipientEmail: to, rawMessage: body }),
				);

			const uid = "remote-evt-1@example.com";
			const r1 = await runtime.runPromise(
				inbound(REQUEST_BODY(uid, "Lunch"), "alice@example.com"),
			);
			expect(r1._tag).toBe("Applied");

			// Should now exist in Alice's calendar.
			const after1 = await runtime.runPromise(
				Effect.flatMap(InstanceRepository, (r) => r.listByCollection(aliceCal)),
			);
			expect(after1.length).toBe(1);

			// Same UID, updated SUMMARY → applies as update (still 1 instance).
			const r2 = await runtime.runPromise(
				inbound(REQUEST_BODY(uid, "Long lunch"), "alice@example.com"),
			);
			expect(r2._tag).toBe("Applied");
			const after2 = await runtime.runPromise(
				Effect.flatMap(InstanceRepository, (r) => r.listByCollection(aliceCal)),
			);
			expect(after2.length).toBe(1);

			// CANCEL → removes.
			const r3 = await runtime.runPromise(
				inbound(CANCEL_BODY(uid), "alice@example.com"),
			);
			expect(r3._tag).toBe("Applied");
			const after3 = await runtime.runPromise(
				Effect.flatMap(InstanceRepository, (r) => r.listByCollection(aliceCal)),
			);
			expect(after3.length).toBe(0);

			// Unknown recipient.
			const r4 = await runtime.runPromise(
				inbound(REQUEST_BODY("x", "x"), "bob@example.com"),
			);
			expect(r4._tag).toBe("UnknownRecipient");
		} finally {
			await runtime.dispose();
		}
	});
});
