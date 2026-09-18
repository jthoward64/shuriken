import { Effect, Layer, Option, Semaphore } from "effect";
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
	type InstanceId,
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
	const safe = uid.replace(/[^A-Za-z0-9._-]/gu, "_").slice(0, SLUG_MAX_BODY);
	return Slug(`${safe || "birthday"}.ics`);
};

// Concurrent `regenerate` calls for the same target collection (e.g. two
// fire-and-forget triggers from bulk vCard writes racing the scheduler tick)
// both snapshot the same "missing" birthday and race to insert it, tripping
// `unique_instance_slug_per_collection`. Serialize per collection so callers
// queue instead of racing; different collections still run concurrently.
const collectionLocks = new Map<CollectionId, Semaphore.Semaphore>();
const lockFor = (collectionId: CollectionId): Semaphore.Semaphore => {
	const existing = collectionLocks.get(collectionId);
	if (existing !== undefined) {
		return existing;
	}
	const lock = Semaphore.makeUnsafe(1);
	collectionLocks.set(collectionId, lock);
	return lock;
};

/** The birthday event a card should produce, keyed by its birthday UID. */
interface DesiredBirthday {
	readonly fn: string;
	readonly bday: string;
	readonly component: IrComponent;
}

/** A birthday instance already present in the target collection. */
interface ExistingBirthday {
	readonly instanceId: InstanceId;
	readonly entityId: EntityId;
	readonly etag: string;
	readonly slug: string;
}

/** The encoded form of one desired birthday, ready to store. */
interface BirthdayPayload {
	readonly uid: string;
	readonly component: IrComponent;
	readonly etag: ETag;
	readonly contentLength: number;
}

/** Collects the birthday event every card in the principal's addressbooks should have. */
const collectDesiredBirthdays = Effect.fn("BirthdayService.collectDesired")(
	function* (principalId: PrincipalId) {
		const cardRepo = yield* CardIndexRepository;
		const collSvc = yield* CollectionService;
		const collections = yield* collSvc.listByOwner(principalId);
		const desired = new Map<string, DesiredBirthday>();
		for (const book of collections) {
			if (book.collectionType !== "addressbook" || book.deletedAt !== null) {
				continue;
			}
			const cards = yield* cardRepo.listWithBday(book.id as CollectionId);
			for (const card of cards) {
				const built = buildBirthdayVevent({
					cardUid: card.uid,
					fn: card.fn,
					bday: card.bday,
				});
				Option.match(built, {
					onNone: () => undefined,
					onSome: (event) =>
						desired.set(event.uid, {
							fn: card.fn,
							bday: card.bday,
							component: event.component,
						}),
				});
			}
		}
		return desired;
	},
);

/** Encodes a desired birthday into the canonical iCalendar payload plus its etag. */
const encodeBirthday = Effect.fn("BirthdayService.encode")(function* (
	uid: string,
	component: IrComponent,
) {
	const canonical = yield* encodeICalendar(wrapInVcalendar(component));
	return {
		uid,
		component,
		etag: ETag(yield* makeEtag(canonical)),
		contentLength: new TextEncoder().encode(canonical).byteLength,
	} satisfies BirthdayPayload;
});

/** Creates the entity, component tree and instance for a new birthday event. */
const insertBirthday = Effect.fn("BirthdayService.insert")(function* (
	targetCollectionId: CollectionId,
	payload: BirthdayPayload,
) {
	const componentRepo = yield* ComponentRepository;
	const entityRepo = yield* EntityRepository;
	const instanceSvc = yield* InstanceService;
	const entityRow = yield* entityRepo.insert({
		entityType: "icalendar",
		logicalUid: payload.uid,
	});
	yield* componentRepo.insertTree(EntityId(entityRow.id), payload.component);
	yield* instanceSvc.put({
		collectionId: targetCollectionId,
		entityId: EntityId(entityRow.id),
		contentType: "text/calendar",
		etag: payload.etag,
		slug: slugFromUid(payload.uid),
		contentLength: payload.contentLength,
	});
});

/** Rewrites an existing birthday instance's component tree and bumps its etag. */
const replaceBirthday = Effect.fn("BirthdayService.replace")(function* (
	targetCollectionId: CollectionId,
	payload: BirthdayPayload,
	prev: ExistingBirthday,
) {
	const componentRepo = yield* ComponentRepository;
	const instanceSvc = yield* InstanceService;
	yield* componentRepo.deleteByEntity(prev.entityId);
	yield* componentRepo.insertTree(prev.entityId, payload.component);
	yield* instanceSvc.put(
		{
			collectionId: targetCollectionId,
			entityId: prev.entityId,
			contentType: "text/calendar",
			etag: payload.etag,
			slug: Slug(prev.slug),
			contentLength: payload.contentLength,
		},
		prev.instanceId,
	);
});

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
	lockFor(targetCollectionId).withPermit(
		Effect.gen(function* () {
			const db = yield* DatabaseClient;
			const entityRepo = yield* EntityRepository;
			const instanceSvc = yield* InstanceService;

			yield* Effect.annotateCurrentSpan({
				"principal.id": principalId,
				"collection.id": targetCollectionId,
			});

			// 1-3. Discover the principal's addressbooks and the events they imply.
			const desired = yield* collectDesiredBirthdays(principalId);

			// 4. Snapshot existing birthday-UID instances in the target collection.
			const rows =
				yield* entityRepo.listActiveInstancesWithUid(targetCollectionId);
			const existingBirthdays = new Map<string, ExistingBirthday>();
			for (const row of rows) {
				if (row.logicalUid?.endsWith(BIRTHDAY_UID_SUFFIX) === true) {
					existingBirthdays.set(row.logicalUid, row);
				}
			}

			let inserted = 0;
			let updated = 0;
			let deleted = 0;

			// 5a. Insert/update.
			for (const [uid, want] of desired) {
				const payload = yield* encodeBirthday(uid, want.component);
				const prev = existingBirthdays.get(uid);
				if (prev === undefined) {
					yield* withTransaction(
						insertBirthday(targetCollectionId, payload),
					).pipe(Effect.provideService(DatabaseClient, db));
					inserted += 1;
				} else if (prev.etag !== payload.etag) {
					yield* withTransaction(
						replaceBirthday(targetCollectionId, payload, prev),
					).pipe(Effect.provideService(DatabaseClient, db));
					updated += 1;
				}
			}

			// 5b. Delete birthdays whose source card lost its BDAY.
			for (const [uid, row] of existingBirthdays) {
				if (!desired.has(uid)) {
					yield* instanceSvc.delete(row.instanceId);
					deleted += 1;
				}
			}

			return { inserted, updated, deleted };
		}),
	);

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
