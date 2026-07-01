import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, ManagedRuntime, Option } from "effect";
import { type CollectionId, EntityId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { CardEditService } from "#src/services/card-edit/service.ts";
import { emptyContactForm } from "#src/services/card-edit/types.ts";
import { CardIndexRepository } from "#src/services/card-index/repository.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";
import { findDuplicateGroups } from "./detect.ts";
import { ContactMergeService } from "./service.ts";

// ---------------------------------------------------------------------------
// ContactMergeService end-to-end:
//   1. Provision alice; create two contacts sharing an email.
//   2. Detection (listForDedup + findDuplicateGroups) groups them together.
//   3. merge() keeps the more complete contact, unions the extra email in,
//      and removes the duplicate instance.
// ---------------------------------------------------------------------------

describe("ContactMergeService (integration)", () => {
	it("detects and merges duplicates by shared email", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const { addressbookId, richId, richEntityId, sparseId } =
				await runtime.runPromise(
					Effect.gen(function* () {
						const prov = yield* ProvisioningService;
						const alice = yield* prov
							.provisionUser({
								email: Email("alice-merge@example.com"),
								name: "Alice",
								slug: Slug("alice"),
							})
							.pipe(Effect.orDie);
						const ab = alice.addressBook.id as CollectionId;
						const svc = yield* CardEditService;

						// Rich contact — many fields ⇒ chosen as the merge primary.
						const rich = yield* svc.create(ab, {
							...emptyContactForm,
							fn: "Bob Builder",
							familyName: "Builder",
							givenName: "Bob",
							emails: [{ value: "bob@example.com", types: ["home"] }],
							tels: [{ value: "+1-555-0101", types: ["cell"] }],
							org: "Acme",
							title: "Architect",
							note: "note",
						});

						// Sparse duplicate — shares the email (different case), adds a
						// second unique email that should survive the merge.
						const sparse = yield* svc.create(ab, {
							...emptyContactForm,
							fn: "Bobby",
							emails: [
								{ value: "BOB@EXAMPLE.COM", types: ["home"] },
								{ value: "bob2@work.example", types: ["work"] },
							],
						});

						return {
							addressbookId: ab,
							richId: rich.instanceId,
							richEntityId: rich.entityId,
							sparseId: sparse.instanceId,
						};
					}),
				);

			// Detection groups the two contacts by email.
			const rows = await runtime.runPromise(
				Effect.flatMap(CardIndexRepository, (r) =>
					r.listForDedup([addressbookId]),
				),
			);
			expect(rows.length).toBe(2);
			const groups = findDuplicateGroups(rows, ["email"]);
			expect(groups.length).toBe(1);
			expect(groups[0]?.length).toBe(2);

			// Merge.
			const result = await runtime.runPromise(
				Effect.flatMap(ContactMergeService, (s) => s.merge([richId, sparseId])),
			);
			expect(result.mergedCount).toBe(1);
			// The rich contact is the survivor.
			expect(result.primaryInstanceId).toBe(richId);
			expect(result.fn).toBe("Bob Builder");

			// Survivor tree carries both emails (deduped by normalization).
			const tree = await runtime.runPromise(
				Effect.flatMap(ComponentRepository, (cr) =>
					cr.loadTree(EntityId(richEntityId), "vcard"),
				),
			);
			expect(Option.isSome(tree)).toBe(true);
			if (Option.isSome(tree)) {
				const emails = tree.value.properties
					.filter((p) => p.name === "EMAIL")
					.map((p) => (p.value.type === "TEXT" ? p.value.value : ""));
				expect(emails).toContain("bob@example.com");
				expect(emails).toContain("bob2@work.example");
				expect(emails.length).toBe(2);
			}

			// Only one active instance remains in the addressbook.
			const remaining = await runtime.runPromise(
				Effect.flatMap(InstanceRepository, (r) =>
					r.listByCollection(addressbookId),
				),
			);
			expect(remaining.length).toBe(1);
			expect(remaining[0]?.id).toBe(richId);
		} finally {
			await runtime.dispose();
		}
	});
});
