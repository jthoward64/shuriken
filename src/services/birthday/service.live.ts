import { Effect, Layer } from "effect";
import { makeEtag } from "#src/data/etag.ts";
import { encodeICalendar } from "#src/data/icalendar/codec.ts";
import type { IrComponent, IrDocument } from "#src/data/ir.ts";
import { DatabaseClient } from "#src/db/client.ts";
import { withTransaction } from "#src/db/transaction.ts";
import type {
	DatabaseError,
	DavError,
	InternalError,
} from "#src/domain/errors.ts";
import {
	type CollectionId,
	EntityId,
	type PrincipalId,
} from "#src/domain/ids.ts";
import { Slug } from "#src/domain/types/path.ts";
import { ETag } from "#src/domain/types/strings.ts";
import { CardIndexRepository } from "#src/services/card-index/repository.ts";
import { CollectionService } from "#src/services/collection/index.ts";
import { ComponentRepository } from "#src/services/component/index.ts";
import { EntityRepository } from "#src/services/entity/index.ts";
import { InstanceService } from "#src/services/instance/index.ts";
import { BIRTHDAY_UID_SUFFIX, buildBirthdayVevent } from "./build-event.ts";
import { BirthdayService } from "./service.ts";

// ---------------------------------------------------------------------------
// BirthdayServiceLive — see service.ts for the contract.
//
// Algorithm:
//   1. List every addressbook collection owned by `principalId`.
//   2. For each addressbook, list (uid, fn, bday) for every card with a BDAY.
//   3. Build the desired VEVENT map keyed by birthday-UID (= cardUid+"-birthday").
//   4. Snapshot existing instances in the target Birthdays collection that have
//      the "-birthday" suffix.
//   5. Diff:
//        – desired ∖ existing  → insert (new entity + tree + instance)
//        – existing ∩ desired  → replace component tree + bump etag iff etag changed
//        – existing ∖ desired  → delete instance (card lost its BDAY)
//
// Existing non-birthday instances in the target collection are left alone:
// users can still drop a personal event into "Birthdays" if they want.
// ---------------------------------------------------------------------------

const wrapInVcalendar = (vevent: IrComponent): IrDocument => ({
	kind: "icalendar",
	root: {
		name: "VCALENDAR",
		properties: [
			{
				name: "VERSION",
				parameters: [],
				value: { type: "TEXT", value: "2.0" },
				isKnown: true,
			},
			{
				name: "PRODID",
				parameters: [],
				value: { type: "TEXT", value: "-//shuriken//birthday//EN" },
				isKnown: true,
			},
		],
		components: [vevent],
	},
});

const SLUG_MAX_BODY = 120;
const slugFromUid = (uid: string): Slug => {
	const safe = uid.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, SLUG_MAX_BODY);
	return Slug(`${safe || "birthday"}.ics`);
};

const regenerate = (
	principalId: PrincipalId,
	targetCollectionId: CollectionId,
): Effect.Effect<
	{
		readonly inserted: number;
		readonly updated: number;
		readonly deleted: number;
	},
	DatabaseError | DavError | InternalError,
	| CardIndexRepository
	| CollectionService
	| ComponentRepository
	| DatabaseClient
	| EntityRepository
	| InstanceService
> =>
	Effect.gen(function* () {
		const cardRepo = yield* CardIndexRepository;
		const collSvc = yield* CollectionService;
		const componentRepo = yield* ComponentRepository;
		const db = yield* DatabaseClient;
		const entityRepo = yield* EntityRepository;
		const instanceSvc = yield* InstanceService;

		yield* Effect.annotateCurrentSpan({
			"principal.id": principalId,
			"collection.id": targetCollectionId,
		});

		// 1. Discover addressbooks owned by this principal.
		const collections = yield* collSvc.listByOwner(principalId);
		const addressbooks = collections.filter(
			(c) => c.collectionType === "addressbook" && c.deletedAt === null,
		);

		// 2-3. Build the desired birthday map.
		const desired = new Map<
			string,
			{
				readonly fn: string;
				readonly bday: string;
				readonly component: IrComponent;
			}
		>();
		for (const book of addressbooks) {
			const cards = yield* cardRepo.listWithBday(book.id as CollectionId);
			for (const card of cards) {
				const built = buildBirthdayVevent({
					cardUid: card.uid,
					fn: card.fn,
					bday: card.bday,
				});
				if (built !== null) {
					desired.set(built.uid, {
						fn: card.fn,
						bday: card.bday,
						component: built.component,
					});
				}
			}
		}

		// 4. Snapshot existing birthday-UID instances in the target collection.
		const existing =
			yield* entityRepo.listActiveInstancesWithUid(targetCollectionId);
		const existingBirthdays = new Map(
			existing
				.filter((r) => r.logicalUid?.endsWith(BIRTHDAY_UID_SUFFIX) ?? false)
				.map((r) => [r.logicalUid as string, r] as const),
		);

		let inserted = 0;
		let updated = 0;
		let deleted = 0;

		// 5a. Insert/update.
		for (const [uid, want] of desired) {
			const canonical = yield* encodeICalendar(wrapInVcalendar(want.component));
			const etag = ETag(yield* makeEtag(canonical));
			const contentLength = new TextEncoder().encode(canonical).byteLength;
			const prev = existingBirthdays.get(uid);

			if (prev === undefined) {
				yield* withTransaction(
					Effect.gen(function* () {
						const entityRow = yield* entityRepo.insert({
							entityType: "icalendar",
							logicalUid: uid,
						});
						yield* componentRepo.insertTree(
							EntityId(entityRow.id),
							want.component,
						);
						yield* instanceSvc.put({
							collectionId: targetCollectionId,
							entityId: EntityId(entityRow.id),
							contentType: "text/calendar",
							etag,
							slug: slugFromUid(uid),
							contentLength,
						});
					}),
				).pipe(Effect.provideService(DatabaseClient, db));
				inserted += 1;
				continue;
			}

			if (prev.etag === etag) {
				continue;
			}
			yield* withTransaction(
				Effect.gen(function* () {
					yield* componentRepo.deleteByEntity(prev.entityId);
					yield* componentRepo.insertTree(prev.entityId, want.component);
					yield* instanceSvc.put(
						{
							collectionId: targetCollectionId,
							entityId: prev.entityId,
							contentType: "text/calendar",
							etag,
							slug: Slug(prev.slug),
							contentLength,
						},
						prev.instanceId,
					);
				}),
			).pipe(Effect.provideService(DatabaseClient, db));
			updated += 1;
		}

		// 5b. Delete birthdays whose source card lost its BDAY.
		for (const [uid, row] of existingBirthdays) {
			if (!desired.has(uid)) {
				yield* instanceSvc.delete(row.instanceId);
				deleted += 1;
			}
		}

		return { inserted, updated, deleted };
	});

export const BirthdayServiceLive = Layer.effect(
	BirthdayService,
	Effect.gen(function* () {
		const cardRepo = yield* CardIndexRepository;
		const collSvc = yield* CollectionService;
		const componentRepo = yield* ComponentRepository;
		const db = yield* DatabaseClient;
		const entityRepo = yield* EntityRepository;
		const instanceSvc = yield* InstanceService;
		return {
			regenerate: (principalId, targetCollectionId) =>
				regenerate(principalId, targetCollectionId).pipe(
					Effect.provideService(CardIndexRepository, cardRepo),
					Effect.provideService(CollectionService, collSvc),
					Effect.provideService(ComponentRepository, componentRepo),
					Effect.provideService(DatabaseClient, db),
					Effect.provideService(EntityRepository, entityRepo),
					Effect.provideService(InstanceService, instanceSvc),
				),
		};
	}),
);
