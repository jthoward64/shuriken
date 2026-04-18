import { Effect, Layer, Option } from "effect";
import { extractUid as icalExtractUid } from "#src/data/icalendar/uid.ts";
import type { IrDocument } from "#src/data/ir.ts";
import { extractUid as vcardExtractUid } from "#src/data/vcard/uid.ts";
import type { EntityType } from "#src/db/drizzle/schema/index.ts";
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
			create: Effect.fn("DomainEntityService.create")(
				function* ({ entityType, document }) {
					yield* Effect.annotateCurrentSpan({ "entity.type": entityType });
					yield* Effect.logTrace("entity.create", { entityType });
					const entity = yield* entityRepo.insert({
						entityType,
						logicalUid: null,
					});
					const uid = extractUidFromDocument(document);
					if (uid !== null) {
						yield* entityRepo.updateLogicalUid(EntityId(entity.id), uid);
					}
					yield* compRepo.insertTree(EntityId(entity.id), document.root);
					yield* Effect.logTrace("entity.create: created", {
						entityId: entity.id,
						hasUid: uid !== null,
					});
					return EntityId(entity.id);
				},
			),

			load: Effect.fn("DomainEntityService.load")(function* (id) {
				yield* Effect.annotateCurrentSpan({ "entity.id": id });
				yield* Effect.logTrace("entity.load", { id });
				const entity = yield* entityRepo.findById(id);
				if (Option.isNone(entity)) {
					yield* Effect.logTrace("entity.load: not found", { id });
					return Option.none<IrDocument>();
				}
				const kind = entity.value.entityType as EntityType;
				const tree = yield* compRepo.loadTree(id, kind);
				if (Option.isNone(tree)) {
					yield* Effect.logTrace("entity.load: component tree not found", { id });
					return Option.none<IrDocument>();
				}
				yield* Effect.logTrace("entity.load result", { id, kind });
				return Option.some<IrDocument>({ kind, root: tree.value });
			}),

			replace: Effect.fn("DomainEntityService.replace")(
				function* (id, document) {
					yield* Effect.annotateCurrentSpan({
						"entity.id": id,
						"entity.kind": document.kind,
					});
					yield* Effect.logTrace("entity.replace", {
						id,
						kind: document.kind,
					});
					yield* compRepo.deleteByEntity(id);
					yield* compRepo.insertTree(id, document.root);
					const uid = extractUidFromDocument(document);
					yield* entityRepo.updateLogicalUid(id, uid);
					yield* Effect.logTrace("entity.replace done", { id });
				},
			),

			remove: Effect.fn("DomainEntityService.remove")(function* (id) {
				yield* Effect.annotateCurrentSpan({ "entity.id": id });
				yield* Effect.logTrace("entity.remove", { id });
				yield* compRepo.deleteByEntity(id);
				yield* entityRepo.softDelete(id);
				yield* Effect.logTrace("entity.remove done", { id });
			}),
		});
	}),
);
