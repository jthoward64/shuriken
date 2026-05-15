import { Effect, Option } from "effect";
import { encodeVCard } from "#src/data/vcard/codec.ts";
import type { DatabaseError, InternalError } from "#src/domain/errors.ts";
import { CollectionId, EntityId, type UuidString } from "#src/domain/ids.ts";
import { ComponentRepository } from "#src/services/component/repository.ts";
import { InstanceRepository } from "#src/services/instance/repository.ts";

// ---------------------------------------------------------------------------
// exportAddressBook — serialize every active card in an addressbook to a
// concatenated VCF stream. Each VCARD is a self-contained document; vCard
// has no top-level wrapper analogous to VCALENDAR.
// ---------------------------------------------------------------------------

export const exportAddressBookToVcf = (
	collectionId: UuidString,
): Effect.Effect<
	string,
	DatabaseError | InternalError,
	ComponentRepository | InstanceRepository
> =>
	Effect.gen(function* () {
		const instanceRepo = yield* InstanceRepository;
		const componentRepo = yield* ComponentRepository;

		const parts: Array<string> = [];
		const instances = yield* instanceRepo.listByCollection(
			CollectionId(collectionId),
		);
		for (const instance of instances) {
			if (instance.deletedAt !== null) {
				continue;
			}
			if (
				instance.contentType.split(";")[0]?.trim().toLowerCase() !==
				"text/vcard"
			) {
				continue;
			}
			const treeOpt = yield* componentRepo.loadTree(
				EntityId(instance.entityId),
				"vcard",
			);
			if (Option.isNone(treeOpt)) {
				continue;
			}
			const root = treeOpt.value;
			if (root.name !== "VCARD") {
				continue;
			}
			parts.push(yield* encodeVCard({ kind: "vcard", root }));
		}
		return parts.join("");
	});
