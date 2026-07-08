import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, ManagedRuntime, Redacted } from "effect";
import {
	type CollectionId,
	EntityId,
	type PrincipalId,
	UserId,
} from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { handleRequest } from "#src/http/router.ts";
import { CalEditService } from "#src/services/cal-edit/service.ts";
import { emptyEventForm } from "#src/services/cal-edit/types.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { UserService } from "#src/services/user/index.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";
import { mockClientAddress } from "#src/testing/script-runner/runner.ts";

// ---------------------------------------------------------------------------
// End-to-end exercise for CalEditService + the events JSON endpoint:
//   * create a timed event, then a recurring all-day event
//   * the JSON feed exposes both with the correct shape
//   * editing the timed event preserves UID and reflects SUMMARY change
//   * deleting drops the event from the feed
// ---------------------------------------------------------------------------

const ALICE_AUTH = `Basic ${btoa("alice@example.com:alice")}`;

describe("Calendar CRUD + events feed (integration)", () => {
	it("create → JSON feed → update → delete", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const { calendarId } = await runtime.runPromise(
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
					yield* userSvc
						.addCredential(UserId(alice.user.user.id), {
							source: "local",
							authId: "alice@example.com",
							password: Redacted.make("alice"),
						})
						.pipe(Effect.orDie);
					return {
						aliceId: alice.user.principal.id as PrincipalId,
						calendarId: alice.calendar.id as CollectionId,
					};
				}),
			);

			// Create a timed event.
			const timed = await runtime.runPromise(
				Effect.flatMap(CalEditService, (s) =>
					s.create(calendarId, {
						...emptyEventForm,
						summary: "Lunch",
						start: "2026-06-01T12:00",
						end: "2026-06-01T13:00",
					}),
				),
			);
			expect(timed.entityId).toBeTruthy();

			// Create a recurring all-day event.
			const recurring = await runtime.runPromise(
				Effect.flatMap(CalEditService, (s) =>
					s.create(calendarId, {
						...emptyEventForm,
						summary: "Anniversary",
						allDay: true,
						start: "2026-06-15",
						end: "2026-06-16",
						recurrenceFreq: "YEARLY",
					}),
				),
			);
			expect(recurring.entityId).toBeTruthy();

			// Sanity probe: instances should exist in the DB now.
			const instances = await runtime.runPromise(
				Effect.flatMap(InstanceRepository, (r) =>
					r.listByCollection(calendarId),
				),
			);
			expect(instances.length).toBe(2);

			// Hit the JSON feed.
			const feedRes = await runtime.runPromise(
				handleRequest(
					new Request(`http://localhost/ui/api/calendar/${calendarId}/events`, {
						headers: { Authorization: ALICE_AUTH },
					}),
					mockClientAddress,
				),
			);
			expect(feedRes.status).toBe(200);
			const feedRaw = await feedRes.text();
			const feed = JSON.parse(feedRaw) as ReadonlyArray<{
				title: string;
				allDay: boolean;
				rrule?: string;
			}>;
			expect(feed.length).toBe(2);
			const lunch = feed.find((e) => e.title === "Lunch");
			const anniversary = feed.find((e) => e.title === "Anniversary");
			expect(lunch?.allDay).toBe(false);
			expect(lunch?.rrule).toBeUndefined();
			expect(anniversary?.allDay).toBe(true);
			expect(anniversary?.rrule).toContain("YEARLY");

			// Update the timed event.
			const updated = await runtime.runPromise(
				Effect.flatMap(CalEditService, (s) =>
					s.update(timed.instanceId, {
						...emptyEventForm,
						summary: "Long lunch",
						start: "2026-06-01T12:00",
						end: "2026-06-01T14:00",
					}),
				),
			);
			expect(updated.uid).toBe(timed.uid);

			// Confirm IR tree reflects the new SUMMARY.
			const tree = await runtime.runPromise(
				Effect.flatMap(ComponentRepository, (cr) =>
					cr.loadTree(EntityId(timed.entityId), "icalendar"),
				),
			);
			expect(tree._tag).toBe("Some");
			if (tree._tag === "Some") {
				const vevent = tree.value.components.find((c) => c.name === "VEVENT");
				const summary = vevent?.properties.find((p) => p.name === "SUMMARY");
				expect(summary?.value).toMatchObject({
					type: "TEXT",
					value: "Long lunch",
				});
			}

			// Delete the recurring event; feed should drop to 1.
			await runtime.runPromise(
				Effect.flatMap(CalEditService, (s) => s.delete(recurring.instanceId)),
			);
			const feedAfter = await runtime.runPromise(
				handleRequest(
					new Request(`http://localhost/ui/api/calendar/${calendarId}/events`, {
						headers: { Authorization: ALICE_AUTH },
					}),
					mockClientAddress,
				),
			);
			const feed2 = (await feedAfter.json()) as ReadonlyArray<unknown>;
			expect(feed2.length).toBe(1);
		} finally {
			await runtime.dispose();
		}
	});
});
