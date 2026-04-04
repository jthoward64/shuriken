import { Effect, Layer, Option } from "effect";
import { extractUid as icalExtractUid } from "#src/data/icalendar/uid.ts";
import type { IrDocument } from "#src/data/ir.ts";
import { extractUid as vcardExtractUid } from "#src/data/vcard/uid.ts";
import { EntityId } from "#src/domain/ids.ts";
import { ComponentRepository } from "#src/services/component/repository.ts";
import { EntityRepository } from "#src/services/entity/repository.ts";
import { DomainEntityService } from "./service.ts";

// ---------------------------------------------------------------------------
// UID extraction — delegates to the appropriate codec extractor
// ---------------------------------------------------------------------------

const extractUidFromDocument = (doc: IrDocument): string | null =>
	Option.getOrNull(
		doc.kind === "icalendar" ? icalExtractUid(doc) : vcardExtractUid(doc),
	);

// ---------------------------------------------------------------------------
// DomainEntityServiceLive
// ---------------------------------------------------------------------------

export const DomainEntityServiceLive = Layer.effect(
	DomainEntityService,
	Effect.gen(function* () {
		const entityRepo = yield* EntityRepository;
		const compRepo = yield* ComponentRepository;

		return DomainEntityService.of({
			create: ({ entityType, document }) =>
				Effect.gen(function* () {
					const entity = yield* entityRepo.insert({
						entityType,
						logicalUid: null,
					});
					const uid = extractUidFromDocument(document);
					if (uid !== null) {
						yield* entityRepo.updateLogicalUid(EntityId(entity.id), uid);
					}
					yield* compRepo.insertTree(EntityId(entity.id), document.root);
					return EntityId(entity.id);
				}),

			load: (id) =>
				Effect.gen(function* () {
					const entity = yield* entityRepo.findById(id);
					if (Option.isNone(entity)) { return Option.none<IrDocument>(); }
					const kind = entity.value.entityType as "icalendar" | "vcard";
					const tree = yield* compRepo.loadTree(id, kind);
					if (Option.isNone(tree)) { return Option.none<IrDocument>(); }
					return Option.some<IrDocument>({ kind, root: tree.value });
				}),

			replace: (id, document) =>
				Effect.gen(function* () {
					yield* compRepo.deleteByEntity(id);
					yield* compRepo.insertTree(id, document.root);
					const uid = extractUidFromDocument(document);
					yield* entityRepo.updateLogicalUid(id, uid);
				}),

			remove: (id) =>
				Effect.gen(function* () {
					yield* compRepo.deleteByEntity(id);
					yield* entityRepo.softDelete(id);
				}),
		});
	}),
);
