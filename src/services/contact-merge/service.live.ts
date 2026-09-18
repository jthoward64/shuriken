import { Effect, Layer, Option } from "effect";
import { makeEtag } from "#src/data/etag.ts";
import type { IrComponent, IrDocument } from "#src/data/ir.ts";
import { encodeVCard } from "#src/data/vcard/codec.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { withTransaction } from "#src/db/transaction.ts";
import {
	badRequest,
	type DatabaseError,
	type DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId, EntityId, InstanceId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { ETag } from "#src/domain/types/strings.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { mergeVcards, pickPrimaryIndex } from "./merge-vcard.ts";
import { type ContactMergeResult, ContactMergeService } from "./service.ts";

// ---------------------------------------------------------------------------
// Live ContactMergeService — see service.ts for the contract.
//
// Load every card's IR tree, auto-pick the most complete as the primary, union
// the others into it, then in one transaction: replace the primary's tree and
// bump its ETag (mirroring CardEditService.update) and soft-delete the rest
// (mirroring CardEditService.delete, so sync tombstones are produced).
// ---------------------------------------------------------------------------

/** The FN text value, absent when the card has none or it is not TEXT. */
const fnOf = (vcard: IrComponent): Option.Option<string> => {
	const fn = vcard.properties.find((p) => p.name.toUpperCase() === "FN");
	return fn?.value.type === "TEXT"
		? Option.some(fn.value.value)
		: Option.none();
};

const wrapInDoc = (vcard: IrComponent): IrDocument => ({
	kind: "vcard",
	root: vcard,
});

/** Replaces the primary card's tree and soft-deletes the cards merged into it. */
const commitMerge = Effect.fn("ContactMergeService.commit")(function* (input: {
	readonly collectionId: CollectionId;
	readonly entityId: EntityId;
	readonly instanceId: InstanceId;
	readonly vcard: IrComponent;
	readonly etag: ETag;
	readonly slug: Slug;
	readonly contentLength: number;
	readonly absorbedInstanceIds: ReadonlyArray<InstanceId>;
}) {
	const componentRepo = yield* ComponentRepository;
	const instanceSvc = yield* InstanceService;
	yield* componentRepo.deleteByEntity(input.entityId);
	yield* componentRepo.insertTree(input.entityId, input.vcard);
	yield* instanceSvc.put(
		{
			collectionId: input.collectionId,
			entityId: input.entityId,
			contentType: "text/vcard",
			etag: input.etag,
			slug: input.slug,
			contentLength: input.contentLength,
		},
		input.instanceId,
	);
	yield* Effect.forEach(input.absorbedInstanceIds, (id) =>
		instanceSvc.delete(id),
	);
});

const merge = (
	instanceIds: ReadonlyArray<InstanceId>,
): Effect.Effect<
	ContactMergeResult,
	DatabaseError | DavError | InternalError,
	ComponentRepository | DatabaseClient | InstanceService
> =>
	Effect.gen(function* () {
		const componentRepo = yield* ComponentRepository;
		const instanceSvc = yield* InstanceService;
		const db = yield* DatabaseClient;

		// Deduplicate ids defensively — the same instance twice must not be
		// "merged into itself" and then deleted.
		const uniqueIds = [...new Set(instanceIds)];
		if (uniqueIds.length < 2) {
			return yield* Effect.fail(
				badRequest("merge requires at least two distinct contacts"),
			);
		}

		const rows = yield* Effect.forEach(uniqueIds, (id) =>
			instanceSvc.findById(id),
		);

		const trees = yield* componentRepo.loadTreesByIds(
			rows.map((r) => EntityId(r.entityId)),
			"vcard",
		);

		const entries = rows.map((row) => {
			const vcard = trees.get(EntityId(row.entityId));
			return { row, vcard };
		});

		const missing = entries.find((e) => e.vcard === undefined);
		if (missing !== undefined) {
			return yield* Effect.fail(
				new InternalError({
					cause: `contact ${missing.row.id} has no vCard content to merge`,
				}),
			);
		}
		// Narrow: every entry has a tree past this point.
		const resolved = entries.map((e) => ({
			row: e.row,
			vcard: e.vcard as IrComponent,
		}));

		const primaryIdx = pickPrimaryIndex(
			resolved.map((e) => ({
				vcard: e.vcard,
				lastModified: String(e.row.lastModified),
			})),
		);
		const primary = resolved[primaryIdx];
		if (primary === undefined) {
			return yield* Effect.fail(
				new InternalError({ cause: "merge: primary contact not resolved" }),
			);
		}
		const others = resolved.filter((_, i) => i !== primaryIdx);

		const mergedVcard = mergeVcards(
			primary.vcard,
			others.map((e) => e.vcard),
		);
		const canonical = yield* encodeVCard(wrapInDoc(mergedVcard));
		const etag = ETag(yield* makeEtag(canonical));
		const contentLength = new TextEncoder().encode(canonical).byteLength;

		const primaryEntityId = EntityId(primary.row.entityId);
		const primaryInstanceId = InstanceId(primary.row.id);

		yield* withTransaction(
			commitMerge({
				collectionId: CollectionId(primary.row.collectionId),
				entityId: primaryEntityId,
				instanceId: primaryInstanceId,
				vcard: mergedVcard,
				etag,
				slug: Slug(primary.row.slug),
				contentLength,
				absorbedInstanceIds: others.map((e) => InstanceId(e.row.id)),
			}),
		).pipe(Effect.provideService(DatabaseClient, db));

		return {
			primaryInstanceId,
			primaryEntityId,
			fn: Option.getOrNull(fnOf(mergedVcard)),
			mergedCount: others.length,
		};
	});

export const ContactMergeServiceLive = Layer.effect(
	ContactMergeService,
	Effect.gen(function* () {
		const componentRepo = yield* ComponentRepository;
		const db = yield* DatabaseClient;
		const instanceSvc = yield* InstanceService;
		return {
			merge: (instanceIds) =>
				merge(instanceIds).pipe(
					Effect.provideService(ComponentRepository, componentRepo),
					Effect.provideService(DatabaseClient, db),
					Effect.provideService(InstanceService, instanceSvc),
				),
		};
	}),
);
