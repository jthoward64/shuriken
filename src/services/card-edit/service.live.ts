import { Effect, Layer } from "effect";
import { makeEtag } from "#src/data/etag.ts";
import type { IrDocument } from "#src/data/ir.ts";
import { encodeVCard } from "#src/data/vcard/codec.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { withTransaction } from "#src/db/transaction.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import { CollectionId, EntityId, type InstanceId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { ETag } from "#src/domain/types/strings.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { buildVcardComponent } from "./build-vcard.ts";
import { CardEditService } from "./service.ts";
import type { ContactFormData } from "./types.ts";

// ---------------------------------------------------------------------------
// Live CardEditService — see service.ts for the contract.
//
// Create / update flow mirrors the external-calendar sync writer: build IR,
// encode, etag, then atomically persist entity + component tree + instance.
// ---------------------------------------------------------------------------

const SLUG_MAX_BODY = 120;

const slugFromUid = (uid: string): Slug => {
	const safe = uid.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, SLUG_MAX_BODY);
	return Slug(`${safe || "contact"}.vcf`);
};

const wrapInDoc = (
	vcard: ReturnType<typeof buildVcardComponent>,
): IrDocument => ({
	kind: "vcard",
	root: vcard,
});

const newUid = (): string => `urn:uuid:${crypto.randomUUID()}`;

const create = (
	addressbookId: CollectionId,
	form: ContactFormData,
): Effect.Effect<
	{
		readonly entityId: EntityId;
		readonly instanceId: InstanceId;
		readonly slug: string;
		readonly uid: string;
	},
	DatabaseError | DavError | InternalError,
	ComponentRepository | DatabaseClient | EntityRepository | InstanceService
> =>
	Effect.gen(function* () {
		const componentRepo = yield* ComponentRepository;
		const entityRepo = yield* EntityRepository;
		const instanceSvc = yield* InstanceService;
		const db = yield* DatabaseClient;

		const uid = newUid();
		const vcard = buildVcardComponent(uid, form);
		const canonical = yield* encodeVCard(wrapInDoc(vcard));
		const etag = ETag(yield* makeEtag(canonical));
		const slug = slugFromUid(uid);
		const contentLength = new TextEncoder().encode(canonical).byteLength;

		const { entityId, instanceId } = yield* withTransaction(
			Effect.gen(function* () {
				const entityRow = yield* entityRepo.insert({
					entityType: "vcard",
					logicalUid: uid,
				});
				const eid = EntityId(entityRow.id);
				yield* componentRepo.insertTree(eid, vcard);
				const instance = yield* instanceSvc.put({
					collectionId: addressbookId,
					entityId: eid,
					contentType: "text/vcard",
					etag,
					slug,
					contentLength,
				});
				return { entityId: eid, instanceId: instance.id as InstanceId };
			}),
		).pipe(Effect.provideService(DatabaseClient, db));

		return { entityId, instanceId, slug, uid };
	});

const update = (
	instanceId: InstanceId,
	form: ContactFormData,
): Effect.Effect<
	{
		readonly entityId: EntityId;
		readonly instanceId: InstanceId;
		readonly slug: string;
		readonly uid: string;
	},
	DatabaseError | DavError | InternalError,
	ComponentRepository | DatabaseClient | EntityRepository | InstanceService
> =>
	Effect.gen(function* () {
		const componentRepo = yield* ComponentRepository;
		const instanceSvc = yield* InstanceService;
		const db = yield* DatabaseClient;

		const existing = yield* instanceSvc.findById(instanceId);
		const existingEntityId = EntityId(existing.entityId);
		const existingCollectionId = CollectionId(existing.collectionId);
		// Preserve the existing entity UID — vCard identity is the UID, so
		// editing the form must not invent a fresh one.
		const existingTreeOpt = yield* componentRepo.loadTree(
			existingEntityId,
			"vcard",
		);
		const uidFromTree =
			existingTreeOpt._tag === "Some"
				? (existingTreeOpt.value.properties
						.find((p) => p.name === "UID")
						?.value.value?.toString() ?? null)
				: null;
		const finalUid = uidFromTree ?? `urn:uuid:${existing.entityId}`;

		const vcard = buildVcardComponent(finalUid, form);
		const canonical = yield* encodeVCard(wrapInDoc(vcard));
		const etag = ETag(yield* makeEtag(canonical));
		const contentLength = new TextEncoder().encode(canonical).byteLength;

		yield* withTransaction(
			Effect.gen(function* () {
				yield* componentRepo.deleteByEntity(existingEntityId);
				yield* componentRepo.insertTree(existingEntityId, vcard);
				yield* instanceSvc.put(
					{
						collectionId: existingCollectionId,
						entityId: existingEntityId,
						contentType: "text/vcard",
						etag,
						slug: Slug(existing.slug),
						contentLength,
					},
					instanceId,
				);
			}),
		).pipe(Effect.provideService(DatabaseClient, db));

		return {
			entityId: existingEntityId,
			instanceId,
			slug: existing.slug,
			uid: finalUid,
		};
	});

const del = (
	instanceId: InstanceId,
): Effect.Effect<
	void,
	DatabaseError | DavError | InternalError,
	InstanceService
> =>
	Effect.gen(function* () {
		const instanceSvc = yield* InstanceService;
		yield* instanceSvc.delete(instanceId);
	});

export const CardEditServiceLive = Layer.effect(
	CardEditService,
	Effect.gen(function* () {
		const componentRepo = yield* ComponentRepository;
		const db = yield* DatabaseClient;
		const entityRepo = yield* EntityRepository;
		const instanceSvc = yield* InstanceService;
		return CardEditService.of({
			create: (addressbookId, form) =>
				create(addressbookId, form).pipe(
					Effect.provideService(ComponentRepository, componentRepo),
					Effect.provideService(DatabaseClient, db),
					Effect.provideService(EntityRepository, entityRepo),
					Effect.provideService(InstanceService, instanceSvc),
				),
			update: (instanceId, form) =>
				update(instanceId, form).pipe(
					Effect.provideService(ComponentRepository, componentRepo),
					Effect.provideService(DatabaseClient, db),
					Effect.provideService(EntityRepository, entityRepo),
					Effect.provideService(InstanceService, instanceSvc),
				),
			delete: (instanceId) =>
				del(instanceId).pipe(
					Effect.provideService(InstanceService, instanceSvc),
				),
		});
	}),
);
