import { Effect, Layer, Option } from "effect";
import { makeEtag } from "#src/data/etag.ts";
import type { IrComponent, IrDocument } from "#src/data/ir.ts";
import { encodeVCard } from "#src/data/vcard/codec.ts";
import { baseName } from "#src/data/vcard/prop.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { withTransaction } from "#src/db/transaction.ts";
import {
	type DatabaseError,
	type DavError,
	type InternalError,
	notFound,
} from "#src/domain/errors.ts";
import { CollectionId, EntityId, type InstanceId } from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { ETag } from "#src/domain/types/strings.ts";
import { fireAndForgetBirthdayRegenerate } from "#src/services/birthday/event-hook.ts";
import { BirthdayService } from "#src/services/birthday/service.ts";
import { CollectionRepository } from "#src/services/collection/repository.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { buildVcardComponent } from "./build-vcard.ts";
import { mergeFormIntoVcard } from "./merge-vcard.ts";
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
	| BirthdayService
	| CollectionRepository
	| ComponentRepository
	| DatabaseClient
	| EntityRepository
	| InstanceService
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

		yield* fireAndForgetBirthdayRegenerate(addressbookId);

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
	| BirthdayService
	| CollectionRepository
	| ComponentRepository
	| DatabaseClient
	| EntityRepository
	| InstanceService
> =>
	Effect.gen(function* () {
		const componentRepo = yield* ComponentRepository;
		const instanceSvc = yield* InstanceService;
		const db = yield* DatabaseClient;

		const existing = yield* instanceSvc.findById(instanceId);
		const existingEntityId = EntityId(existing.entityId);
		const existingCollectionId = CollectionId(existing.collectionId);
		const existingTreeOpt = yield* componentRepo.loadTree(
			existingEntityId,
			"vcard",
		);
		const existingTree = Option.getOrNull(existingTreeOpt);
		// Preserve the existing entity UID — vCard identity is the UID, so
		// editing the form must not invent a fresh one.
		const uidFromTree =
			existingTree?.properties
				.find((p) => baseName(p.name) === "UID")
				?.value.value?.toString() ?? null;
		const finalUid = uidFromTree ?? `urn:uuid:${existing.entityId}`;

		// Non-destructive: merge the form onto the existing card so every
		// unmanaged property/parameter is preserved. (No tree → fresh build.)
		const vcard = existingTree
			? mergeFormIntoVcard(existingTree, form, finalUid)
			: buildVcardComponent(finalUid, form);
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

		yield* fireAndForgetBirthdayRegenerate(existingCollectionId);

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
	BirthdayService | CollectionRepository | InstanceService
> =>
	Effect.gen(function* () {
		const instanceSvc = yield* InstanceService;
		const existing = yield* instanceSvc.findById(instanceId);
		yield* instanceSvc.delete(instanceId);
		yield* fireAndForgetBirthdayRegenerate(CollectionId(existing.collectionId));
	});

const removePhoto = (
	instanceId: InstanceId,
): Effect.Effect<
	{
		readonly entityId: EntityId;
		readonly instanceId: InstanceId;
		readonly slug: string;
		readonly uid: string;
	},
	DatabaseError | DavError | InternalError,
	ComponentRepository | DatabaseClient | InstanceService
> =>
	Effect.gen(function* () {
		const componentRepo = yield* ComponentRepository;
		const instanceSvc = yield* InstanceService;
		const db = yield* DatabaseClient;

		const existing = yield* instanceSvc.findById(instanceId);
		const entityId = EntityId(existing.entityId);
		const treeOpt = yield* componentRepo.loadTree(entityId, "vcard");
		if (treeOpt._tag === "None" || treeOpt.value.name !== "VCARD") {
			return yield* Effect.fail(notFound("Contact not found"));
		}
		const root = treeOpt.value;
		const uid =
			root.properties.find((p) => p.name === "UID")?.value.value?.toString() ??
			`urn:uuid:${existing.entityId}`;

		// Structural edit: strip PHOTO, keep everything else exactly as stored so
		// properties the UI form doesn't model (NICKNAME, IMPP, …) survive.
		const stripped: IrComponent = {
			name: root.name,
			properties: root.properties.filter((p) => p.name !== "PHOTO"),
			components: root.components,
		};

		const canonical = yield* encodeVCard({ kind: "vcard", root: stripped });
		const etag = ETag(yield* makeEtag(canonical));
		const contentLength = new TextEncoder().encode(canonical).byteLength;

		yield* withTransaction(
			Effect.gen(function* () {
				yield* componentRepo.deleteByEntity(entityId);
				yield* componentRepo.insertTree(entityId, stripped);
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

		return { entityId, instanceId, slug: existing.slug, uid };
	});

export const CardEditServiceLive = Layer.effect(
	CardEditService,
	Effect.gen(function* () {
		const birthdaySvc = yield* BirthdayService;
		const collectionRepo = yield* CollectionRepository;
		const componentRepo = yield* ComponentRepository;
		const db = yield* DatabaseClient;
		const entityRepo = yield* EntityRepository;
		const instanceSvc = yield* InstanceService;
		return {
			create: (addressbookId, form) =>
				create(addressbookId, form).pipe(
					Effect.provideService(BirthdayService, birthdaySvc),
					Effect.provideService(CollectionRepository, collectionRepo),
					Effect.provideService(ComponentRepository, componentRepo),
					Effect.provideService(DatabaseClient, db),
					Effect.provideService(EntityRepository, entityRepo),
					Effect.provideService(InstanceService, instanceSvc),
				),
			update: (instanceId, form) =>
				update(instanceId, form).pipe(
					Effect.provideService(BirthdayService, birthdaySvc),
					Effect.provideService(CollectionRepository, collectionRepo),
					Effect.provideService(ComponentRepository, componentRepo),
					Effect.provideService(DatabaseClient, db),
					Effect.provideService(EntityRepository, entityRepo),
					Effect.provideService(InstanceService, instanceSvc),
				),
			delete: (instanceId) =>
				del(instanceId).pipe(
					Effect.provideService(BirthdayService, birthdaySvc),
					Effect.provideService(CollectionRepository, collectionRepo),
					Effect.provideService(InstanceService, instanceSvc),
				),
			removePhoto: (instanceId) =>
				removePhoto(instanceId).pipe(
					Effect.provideService(ComponentRepository, componentRepo),
					Effect.provideService(DatabaseClient, db),
					Effect.provideService(InstanceService, instanceSvc),
				),
		};
	}),
);
