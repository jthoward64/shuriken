import { expect } from "@std/expect";
import { describe, it } from "@std/testing/bdd";
import { Effect, ManagedRuntime, Option } from "effect";
import { type CollectionId, EntityId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { Email } from "#src/domain/types/strings.ts";
import { CardEditService } from "#src/services/card-edit/service.ts";
import { CardIndexRepository } from "#src/services/card-index/repository.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { ProvisioningService } from "#src/services/provisioning/index.ts";
import { makeScriptRunnerLayer } from "#src/testing/script-runner/layer.ts";
import { emptyContactForm } from "./types.ts";

// ---------------------------------------------------------------------------
// Profile-picture support:
//   * The card_index trigger records has_photo, surfaced by listForCollection.
//   * CardEditService.removePhoto strips PHOTO structurally, preserving every
//     other vCard property.
// ---------------------------------------------------------------------------

// A minimal but valid 1x1 PNG.
const PNG_DATA_URI =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAoxL8HcAAAAASUVORK5CYII=";

describe("Contact photo support (integration)", () => {
	it("flags has_photo in the card_index and clears it on removePhoto", async () => {
		const runtime = ManagedRuntime.make(makeScriptRunnerLayer());
		try {
			await runtime.runPromise(
				Effect.gen(function* () {
					const prov = yield* ProvisioningService;
					const cardEdit = yield* CardEditService;
					const cardIndex = yield* CardIndexRepository;
					const componentRepo = yield* ComponentRepository;

					const alice = yield* prov
						.provisionUser({
							email: Email("alice-photo@example.com"),
							name: "Alice",
							slug: Slug("alice-photo"),
						})
						.pipe(Effect.orDie);
					const ab = alice.addressBook.id as CollectionId;

					const withPhoto = yield* cardEdit.create(ab, {
						...emptyContactForm,
						fn: "Pat Photo",
						familyName: "Photo",
						givenName: "Pat",
						emails: [
							{ value: "pat@example.com", types: ["home"], preferred: false },
						],
						photo: PNG_DATA_URI,
					});
					const withoutPhoto = yield* cardEdit.create(ab, {
						...emptyContactForm,
						fn: "No Picture",
					});

					// has_photo is projected straight from the trigger-maintained index.
					const listed = yield* cardIndex.listForCollection(ab);
					const photoRow = listed.find(
						(r) => r.instanceId === withPhoto.instanceId,
					);
					const plainRow = listed.find(
						(r) => r.instanceId === withoutPhoto.instanceId,
					);
					expect(photoRow?.hasPhoto).toBe(true);
					expect(plainRow?.hasPhoto).toBe(false);

					// removePhoto strips PHOTO but keeps the rest of the card.
					yield* cardEdit.removePhoto(withPhoto.instanceId);

					const treeOpt = yield* componentRepo.loadTree(
						EntityId(withPhoto.entityId),
						"vcard",
					);
					expect(Option.isSome(treeOpt)).toBe(true);
					const root = Option.getOrThrow(treeOpt);
					const names = root.properties.map((p) => p.name);
					expect(names).not.toContain("PHOTO");
					// Untouched properties survive the structural edit.
					expect(names).toContain("FN");
					expect(names).toContain("EMAIL");

					const relisted = yield* cardIndex.listForCollection(ab);
					const clearedRow = relisted.find(
						(r) => r.instanceId === withPhoto.instanceId,
					);
					expect(clearedRow?.hasPhoto).toBe(false);
				}),
			);
		} finally {
			await runtime.dispose();
		}
	});
});
