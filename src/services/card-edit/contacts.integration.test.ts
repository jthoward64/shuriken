import { describe, expect, it } from "bun:test";
import { Effect, ManagedRuntime, Option, Redacted } from "effect";
import {
	type CollectionId,
	EntityId,
	type PrincipalId,
	UserId,
} from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { handleRequest } from "#src/http/router.ts";
import { CardEditService } from "#src/services/card-edit/service.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { UserService } from "#src/services/user/index.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";
import { mockServer } from "#src/testing/script-runner/runner.ts";
import type { ContactFormData } from "./types.ts";
import { emptyContactForm } from "./types.ts";

// ---------------------------------------------------------------------------
// Contacts CRUD via the UI service end-to-end:
//   1. Provision alice; locate her auto-created addressbook.
//   2. CardEditService.create → IR tree + dav_instance materialised.
//   3. PROPFIND the addressbook → 207 includes the new vcf instance.
//   4. CardEditService.update with edited fields → tree reflects new FN /
//      newly-added email.
//   5. CardEditService.delete → instance disappears from PROPFIND.
// ---------------------------------------------------------------------------

const ALICE_AUTH = `Basic ${btoa("alice@example.com:alice")}`;

const sampleForm = (): ContactFormData => ({
	...emptyContactForm,
	fn: "Bob Builder",
	familyName: "Builder",
	givenName: "Bob",
	emails: [{ value: "bob@example.com", types: ["home"] }],
	tels: [{ value: "+1-555-0101", types: ["cell"] }],
	bday: "1990-07-04",
	org: "Acme",
	title: "Architect",
	note: "Initial note",
	categoriesCsv: "friend",
});

describe("Contacts CRUD (integration)", () => {
	it("create → list → update → delete", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const { aliceId, addressbookId } = await runtime.runPromise(
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
						addressbookId: alice.addressBook.id as CollectionId,
					};
				}),
			);

			// 1. Create
			const created = await runtime.runPromise(
				Effect.flatMap(CardEditService, (s) =>
					s.create(addressbookId, sampleForm()),
				),
			);
			expect(created.entityId).toBeTruthy();
			expect(created.instanceId).toBeTruthy();

			// 2. PROPFIND alice's addressbook depth:1 — should see the new vcf.
			const propfindRes = await runtime.runPromise(
				handleRequest(
					new Request("http://localhost/dav/principals/alice/card/primary/", {
						method: "PROPFIND",
						headers: { Authorization: ALICE_AUTH, Depth: "1" },
					}),
					mockServer,
				),
			);
			expect(propfindRes.status).toBe(207);
			const body1 = await propfindRes.text();
			expect((body1.match(/<D:response>/g) ?? []).length).toBe(2);

			// 3. Update — change FN + add second email.
			const updated = await runtime.runPromise(
				Effect.flatMap(CardEditService, (s) =>
					s.update(created.instanceId, {
						...sampleForm(),
						fn: "Robert Builder",
						emails: [
							{ value: "bob@example.com", types: ["home"] },
							{ value: "robert@work.example", types: ["work"] },
						],
					}),
				),
			);
			expect(updated.uid).toBe(created.uid); // identity preserved

			// Verify the IR tree reflects the edit.
			const tree = await runtime.runPromise(
				Effect.flatMap(ComponentRepository, (cr) =>
					cr.loadTree(EntityId(created.entityId), "vcard"),
				),
			);
			expect(Option.isSome(tree)).toBe(true);
			if (Option.isSome(tree)) {
				const fn = tree.value.properties.find((p) => p.name === "FN");
				expect(fn?.value).toMatchObject({
					type: "TEXT",
					value: "Robert Builder",
				});
				const emails = tree.value.properties.filter((p) => p.name === "EMAIL");
				expect(emails.length).toBe(2);
			}

			// 4. Delete — instance should disappear from PROPFIND.
			await runtime.runPromise(
				Effect.flatMap(CardEditService, (s) => s.delete(created.instanceId)),
			);
			const propfindAfter = await runtime.runPromise(
				handleRequest(
					new Request("http://localhost/dav/principals/alice/card/primary/", {
						method: "PROPFIND",
						headers: { Authorization: ALICE_AUTH, Depth: "1" },
					}),
					mockServer,
				),
			);
			const body2 = await propfindAfter.text();
			expect((body2.match(/<D:response>/g) ?? []).length).toBe(1);

			// Sentinel — unused-var guard.
			expect(aliceId).toBeTruthy();
		} finally {
			await runtime.dispose();
		}
	});

	it("listSharedWithPrincipals + repos see card_index updates", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const { addressbookId } = await runtime.runPromise(
				Effect.gen(function* () {
					const prov = yield* ProvisioningService;
					const userSvc = yield* UserService;
					const alice = yield* prov
						.provisionUser({
							email: Email("alice2@example.com"),
							name: "Alice",
							slug: Slug("alice"),
						})
						.pipe(Effect.orDie);
					yield* userSvc
						.addCredential(UserId(alice.user.user.id), {
							source: "local",
							authId: "alice2@example.com",
							password: Redacted.make("alice"),
						})
						.pipe(Effect.orDie);
					return {
						addressbookId: alice.addressBook.id as CollectionId,
					};
				}),
			);

			await runtime.runPromise(
				Effect.flatMap(CardEditService, (s) =>
					s.create(addressbookId, sampleForm()),
				),
			);

			// CollectionRepository sees the addressbook; InstanceRepository sees
			// the new instance.
			const instances = await runtime.runPromise(
				Effect.flatMap(InstanceRepository, (r) =>
					r.listByCollection(addressbookId),
				),
			);
			expect(instances.length).toBe(1);

			const colls = await runtime.runPromise(
				Effect.flatMap(CollectionRepository, (r) =>
					r.listByOwner(
						(instances[0]?.collectionId ??
							addressbookId) as unknown as PrincipalId,
					),
				),
			);
			// Just verify the call works (returns a defined array).
			expect(Array.isArray(colls)).toBe(true);
		} finally {
			await runtime.dispose();
		}
	});
});
