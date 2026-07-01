/** biome-ignore-all lint/style/useNamingConvention: tagged-union discriminants use _tag */
import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, ManagedRuntime, Option } from "effect";
import { type CollectionId, EntityId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { CardEditService } from "#src/services/card-edit/service.ts";
import { emptyContactForm } from "#src/services/card-edit/types.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";
import { ContactCleanupService } from "./service.ts";
import type { CleanupFix } from "./types.ts";

// ---------------------------------------------------------------------------
// ContactCleanupService end-to-end against a real DB:
//   1. Provision alice; create a deliberately messy contact.
//   2. scan → surfaces suggestions across categories.
//   3. applyFix (lowercase an email) → persists, preserving other properties.
//   4. A stale fix (wrong `current`) is rejected rather than clobbering.
// ---------------------------------------------------------------------------

const messyForm = () => ({
	...emptyContactForm,
	fn: "MCDONALD",
	familyName: "MCDONALD",
	givenName: "JOHN",
	// Uppercase address + a bogus TYPE=VALUE label on the same property.
	emails: [{ value: "John@X.COM", types: ["VALUE"] }],
	tels: [{ value: "(415) 555-2671", types: ["cell"] }],
});

describe("ContactCleanupService (integration)", () => {
	it("scans, applies a fix surgically, and rejects stale fixes", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			const { addressbookId } = await runtime.runPromise(
				Effect.gen(function* () {
					const prov = yield* ProvisioningService;
					const alice = yield* prov
						.provisionUser({
							email: Email("cleanup-alice@example.com"),
							name: "Alice",
							slug: Slug("cleanup-alice"),
						})
						.pipe(Effect.orDie);
					return {
						addressbookId: alice.addressBook.id as CollectionId,
					};
				}),
			);

			const created = await runtime.runPromise(
				Effect.flatMap(CardEditService, (s) =>
					s.create(addressbookId, messyForm()),
				),
			);

			// 1. Scan surfaces suggestions across categories.
			const suggestions = await runtime.runPromise(
				Effect.flatMap(ContactCleanupService, (s) =>
					s.scan(addressbookId, "US"),
				),
			);
			const categories = new Set(suggestions.map((x) => x.category));
			expect(categories.has("email")).toBe(true);
			expect(categories.has("name")).toBe(true);
			expect(categories.has("phone")).toBe(true);
			expect(categories.has("label")).toBe(true);
			for (const s of suggestions) {
				expect(s.instanceId).toBe(created.instanceId);
			}

			// 2. Apply the email-lowercasing fix.
			const emailFix = suggestions.find((x) => x.category === "email")
				?.fix as CleanupFix;
			await runtime.runPromise(
				Effect.flatMap(ContactCleanupService, (s) =>
					s.applyFix(created.instanceId, emailFix),
				),
			);

			// 3. The email is lowercased; FN is untouched (surgical edit).
			const tree = await runtime.runPromise(
				Effect.flatMap(ComponentRepository, (cr) =>
					cr.loadTree(EntityId(created.entityId), "vcard"),
				),
			);
			expect(Option.isSome(tree)).toBe(true);
			if (Option.isSome(tree)) {
				const email = tree.value.properties.find((p) => p.name === "EMAIL");
				expect(email?.value).toMatchObject({
					type: "TEXT",
					value: "john@x.com",
				});
				const fn = tree.value.properties.find((p) => p.name === "FN");
				expect(fn?.value).toMatchObject({ type: "TEXT", value: "MCDONALD" });
			}

			// 4. A stale fix (current no longer matches) is rejected.
			const stale: CleanupFix = {
				_tag: "LowercaseEmail",
				occurrence: 0,
				current: "John@X.COM", // already lowercased above
				next: "john@x.com",
			};
			const outcome = await runtime.runPromise(
				Effect.flatMap(ContactCleanupService, (s) =>
					s.applyFix(created.instanceId, stale).pipe(
						Effect.as("applied"),
						Effect.catchTag("DavError", () => Effect.succeed("rejected")),
					),
				),
			);
			expect(outcome).toBe("rejected");
		} finally {
			await runtime.dispose();
		}
	});
});
