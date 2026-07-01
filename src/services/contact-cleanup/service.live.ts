import { Effect, Layer, Option, Result } from "effect";
import { makeEtag } from "#src/data/etag.ts";
import { encodeVCard } from "#src/data/vcard/codec.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { withTransaction } from "#src/db/transaction.ts";
import {
	conflict,
	type DatabaseError,
	type DavError,
	notFound,
} from "#src/domain/errors.ts";
import { CollectionId, EntityId, type InstanceId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { ETag } from "#src/domain/types/strings.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { analyzeCard } from "./analyze.ts";
import { applyFix as applyFixToVcard } from "./apply-fix.ts";
import { ContactCleanupService } from "./service.ts";
import type { CleanupFix, CleanupSuggestion } from "./types.ts";

// ---------------------------------------------------------------------------
// Live ContactCleanupService. The write-back mirrors CardEditService.update:
// re-encode the mutated IR, new etag, then atomically replace the component
// tree and refresh the instance row inside one transaction.
// ---------------------------------------------------------------------------

const scan = (
	collectionId: CollectionId,
	region: string,
): Effect.Effect<
	ReadonlyArray<CleanupSuggestion>,
	DatabaseError,
	ComponentRepository | InstanceService
> =>
	Effect.gen(function* () {
		const instanceSvc = yield* InstanceService;
		const componentRepo = yield* ComponentRepository;

		const instances = (yield* instanceSvc.listByCollection(
			collectionId,
		)).filter((i) => i.contentType === "text/vcard");
		const trees = yield* componentRepo.loadTreesByIds(
			instances.map((i) => EntityId(i.entityId)),
			"vcard",
		);

		const out: Array<CleanupSuggestion> = [];
		for (const inst of instances) {
			const tree = trees.get(EntityId(inst.entityId));
			if (tree === undefined) {
				continue;
			}
			out.push(...analyzeCard(tree, inst.id as InstanceId, region));
		}
		return out;
	});

const applyFix = (
	instanceId: InstanceId,
	fix: CleanupFix,
): Effect.Effect<
	void,
	DatabaseError | DavError,
	ComponentRepository | DatabaseClient | InstanceService
> =>
	Effect.gen(function* () {
		const instanceSvc = yield* InstanceService;
		const componentRepo = yield* ComponentRepository;
		const db = yield* DatabaseClient;

		const existing = yield* instanceSvc.findById(instanceId);
		const entityId = EntityId(existing.entityId);

		const tree = yield* Option.match(
			yield* componentRepo.loadTree(entityId, "vcard"),
			{
				onNone: () => Effect.fail(notFound("contact not found")),
				onSome: Effect.succeed,
			},
		);

		const vcard = yield* Result.match(applyFixToVcard(tree, fix), {
			onFailure: (e) => Effect.fail(conflict(undefined, e.reason)),
			onSuccess: Effect.succeed,
		});

		const canonical = yield* encodeVCard({ kind: "vcard", root: vcard });
		const etag = ETag(yield* makeEtag(canonical));
		const contentLength = new TextEncoder().encode(canonical).byteLength;

		yield* withTransaction(
			Effect.gen(function* () {
				yield* componentRepo.deleteByEntity(entityId);
				yield* componentRepo.insertTree(entityId, vcard);
				yield* instanceSvc.put(
					{
						collectionId: CollectionId(existing.collectionId),
						entityId,
						contentType: "text/vcard",
						etag,
						slug: Slug(existing.slug),
						contentLength,
					},
					instanceId,
				);
			}),
		).pipe(Effect.provideService(DatabaseClient, db));
	});

export const ContactCleanupServiceLive = Layer.effect(
	ContactCleanupService,
	Effect.gen(function* () {
		const componentRepo = yield* ComponentRepository;
		const db = yield* DatabaseClient;
		const instanceSvc = yield* InstanceService;
		return {
			scan: (collectionId, region) =>
				scan(collectionId, region).pipe(
					Effect.provideService(ComponentRepository, componentRepo),
					Effect.provideService(InstanceService, instanceSvc),
				),
			applyFix: (instanceId, fix) =>
				applyFix(instanceId, fix).pipe(
					Effect.provideService(ComponentRepository, componentRepo),
					Effect.provideService(DatabaseClient, db),
					Effect.provideService(InstanceService, instanceSvc),
				),
		};
	}),
);
